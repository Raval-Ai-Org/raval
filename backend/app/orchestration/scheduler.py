"""
Production Orchestration & Monitoring - Timezone-Safe Scheduler.

Provides deterministic next-execution calculation, timezone awareness via IANA zones,
duplicate schedule firing protection, and minimum-interval enforcement.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
from typing import Any
import zoneinfo

from .enums import ScheduleType
from .exceptions import InvalidScheduleExpressionError, InvalidTimezoneError

logger = logging.getLogger(__name__)

# System-wide absolute minimum interval between schedule firings (seconds)
ABSOLUTE_MINIMUM_INTERVAL_SECONDS: int = 60
DEFAULT_MINIMUM_INTERVAL_SECONDS: int = 300


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def validate_timezone(tz_name: str) -> zoneinfo.ZoneInfo:
    """
    Validates that a timezone string corresponds to a known IANA timezone identifier.
    Raises InvalidTimezoneError if unknown or invalid.
    """
    if not isinstance(tz_name, str) or not tz_name.strip():
        raise InvalidTimezoneError(str(tz_name), "Timezone identifier cannot be empty.")
    
    clean_tz = tz_name.strip()
    try:
        return zoneinfo.ZoneInfo(clean_tz)
    except Exception as exc:
        raise InvalidTimezoneError(
            clean_tz,
            reason=f"Unknown or unrecognized timezone identifier: {exc}",
        ) from exc


def _parse_cron_field(field_str: str, min_val: int, max_val: int, field_name: str) -> set[int]:
    """
    Parses a single cron field component supporting *, */step, ranges (x-y), and lists (x,y,z).
    """
    allowed: set[int] = set()
    parts = field_str.split(",")
    for part in parts:
        part = part.strip()
        if not part:
            raise InvalidScheduleExpressionError(field_str, "cron", f"Empty segment in {field_name}")

        step = 1
        if "/" in part:
            subparts = part.split("/")
            if len(subparts) != 2:
                raise InvalidScheduleExpressionError(field_str, "cron", f"Invalid step syntax in {field_name}")
            range_part, step_part = subparts
            try:
                step = int(step_part)
                if step <= 0:
                    raise ValueError()
            except ValueError:
                raise InvalidScheduleExpressionError(
                    field_str, "cron", f"Invalid positive integer step '{step_part}' in {field_name}"
                )
        else:
            range_part = part

        if range_part == "*":
            start, end = min_val, max_val
        elif "-" in range_part:
            sub = range_part.split("-")
            if len(sub) != 2:
                raise InvalidScheduleExpressionError(field_str, "cron", f"Invalid range syntax in {field_name}")
            try:
                start, end = int(sub[0]), int(sub[1])
            except ValueError:
                raise InvalidScheduleExpressionError(
                    field_str, "cron", f"Invalid range bounds in {field_name}"
                )
        else:
            try:
                start = end = int(range_part)
            except ValueError:
                raise InvalidScheduleExpressionError(
                    field_str, "cron", f"Invalid numeric value '{range_part}' in {field_name}"
                )

        if start < min_val or end > max_val or start > end:
            raise InvalidScheduleExpressionError(
                field_str,
                "cron",
                f"Value out of bounds ({min_val}-{max_val}) in {field_name}: '{start}-{end}'",
            )
        allowed.update(range(start, end + 1, step))
    return allowed


class ParsedCron:
    """Compiled, validated 5-part cron expression."""

    def __init__(self, expression: str) -> None:
        self.raw_expression = expression.strip()
        fields = self.raw_expression.split()
        if len(fields) != 5:
            raise InvalidScheduleExpressionError(
                self.raw_expression,
                "cron",
                f"Cron expression must contain exactly 5 space-delimited fields, got {len(fields)}",
            )

        self.minutes = _parse_cron_field(fields[0], 0, 59, "minute")
        self.hours = _parse_cron_field(fields[1], 0, 23, "hour")
        self.days_of_month = _parse_cron_field(fields[2], 1, 31, "day_of_month")
        self.months = _parse_cron_field(fields[3], 1, 12, "month")
        
        # Day of week: 0-7, where 0 and 7 are Sunday
        dows = _parse_cron_field(fields[4], 0, 7, "day_of_week")
        if 7 in dows:
            dows.remove(7)
            dows.add(0)
        self.days_of_week = dows


def validate_cron_expression(expression: str) -> ParsedCron:
    """Validates and parses a 5-part cron expression string."""
    return ParsedCron(expression)


def calculate_next_cron_occurrence(
    cron_expr: str | ParsedCron,
    tz: zoneinfo.ZoneInfo,
    from_time: datetime | None = None,
    minimum_interval_seconds: int = DEFAULT_MINIMUM_INTERVAL_SECONDS,
) -> datetime:
    """
    Computes the next valid execution timestamp in canonical UTC for a given cron expression.
    Guarantees that the next occurrence is strictly >= from_time + minimum_interval_seconds.
    """
    parsed = cron_expr if isinstance(cron_expr, ParsedCron) else validate_cron_expression(cron_expr)
    base_utc = from_time or _utc_now()
    if base_utc.tzinfo is None:
        base_utc = base_utc.replace(tzinfo=timezone.utc)
    else:
        base_utc = base_utc.astimezone(timezone.utc)

    # Minimum threshold to protect against too-frequent execution
    min_threshold_utc = base_utc + timedelta(seconds=max(minimum_interval_seconds, ABSOLUTE_MINIMUM_INTERVAL_SECONDS))
    current_local = min_threshold_utc.astimezone(tz)

    # Round up to next whole minute if seconds/microseconds present
    if current_local.second > 0 or current_local.microsecond > 0:
        current_local = current_local.replace(second=0, microsecond=0) + timedelta(minutes=1)
    else:
        current_local = current_local.replace(microsecond=0)

    # Search window: up to 366 days
    limit_time = current_local + timedelta(days=366)

    while current_local <= limit_time:
        if current_local.month not in parsed.months:
            # Advance to first day of next month at 00:00
            if current_local.month == 12:
                current_local = current_local.replace(year=current_local.year + 1, month=1, day=1, hour=0, minute=0)
            else:
                current_local = current_local.replace(month=current_local.month + 1, day=1, hour=0, minute=0)
            continue

        dow = (current_local.weekday() + 1) % 7  # 0=Sunday
        if current_local.day not in parsed.days_of_month or dow not in parsed.days_of_week:
            # Advance to next day at 00:00
            current_local = (current_local + timedelta(days=1)).replace(hour=0, minute=0)
            continue

        if current_local.hour not in parsed.hours:
            # Advance to next hour at minute 0
            current_local = (current_local + timedelta(hours=1)).replace(minute=0)
            continue

        if current_local.minute not in parsed.minutes:
            current_local += timedelta(minutes=1)
            continue

        # Found matching occurrence! Convert back to UTC
        return current_local.astimezone(timezone.utc)

    raise InvalidScheduleExpressionError(
        str(parsed.raw_expression),
        "cron",
        "No matching occurrence found within the next 366 days.",
    )


def calculate_next_interval_occurrence(
    interval_seconds: int,
    from_time: datetime | None = None,
    minimum_interval_seconds: int = DEFAULT_MINIMUM_INTERVAL_SECONDS,
) -> datetime:
    """
    Computes the next execution timestamp for an interval schedule in canonical UTC.
    Enforces minimum interval protection.
    """
    effective_interval = max(interval_seconds, minimum_interval_seconds, ABSOLUTE_MINIMUM_INTERVAL_SECONDS)
    base_utc = from_time or _utc_now()
    if base_utc.tzinfo is None:
        base_utc = base_utc.replace(tzinfo=timezone.utc)
    else:
        base_utc = base_utc.astimezone(timezone.utc)

    return base_utc + timedelta(seconds=effective_interval)


def calculate_next_run_at(
    schedule_type: ScheduleType | str,
    cron_expression: str | None,
    interval_seconds: int | None,
    timezone_str: str = "UTC",
    minimum_interval_seconds: int = DEFAULT_MINIMUM_INTERVAL_SECONDS,
    from_time: datetime | None = None,
) -> datetime | None:
    """
    Central dispatcher to calculate the deterministic next_run_at in UTC.
    Returns None for ON_DEMAND schedules.
    """
    sched_type = ScheduleType(schedule_type) if isinstance(schedule_type, str) else schedule_type
    tz = validate_timezone(timezone_str)

    if sched_type == ScheduleType.ON_DEMAND:
        return None

    if sched_type == ScheduleType.CRON:
        if not cron_expression:
            raise InvalidScheduleExpressionError("", "cron", "Cron expression is required for CRON schedules.")
        return calculate_next_cron_occurrence(
            cron_expr=cron_expression,
            tz=tz,
            from_time=from_time,
            minimum_interval_seconds=minimum_interval_seconds,
        )

    if sched_type == ScheduleType.INTERVAL:
        if interval_seconds is None or interval_seconds < ABSOLUTE_MINIMUM_INTERVAL_SECONDS:
            raise InvalidScheduleExpressionError(
                str(interval_seconds),
                "interval",
                f"Interval seconds must be at least {ABSOLUTE_MINIMUM_INTERVAL_SECONDS} seconds.",
            )
        return calculate_next_interval_occurrence(
            interval_seconds=interval_seconds,
            from_time=from_time,
            minimum_interval_seconds=minimum_interval_seconds,
        )

    return None


def generate_schedule_idempotency_key(schedule_id: str, fire_time: datetime) -> str:
    """
    Generates a deterministic idempotency key for a recurring schedule firing window.
    Ensures repeated evaluation or polling of the same schedule window never produces duplicate runs.
    """
    utc_time = fire_time.astimezone(timezone.utc) if fire_time.tzinfo else fire_time
    time_str = utc_time.strftime("%Y%m%d%H%M%S")
    return f"sched:{schedule_id}:{time_str}"


def generate_run_now_idempotency_key(schedule_id: str, request_token: str | None = None) -> str:
    """
    Generates a deterministic or token-scoped idempotency key for an ad-hoc run-now trigger.
    """
    if request_token and request_token.strip():
        return f"run_now:{schedule_id}:{request_token.strip()}"
    now_str = _utc_now().strftime("%Y%m%d%H%M%S%f")
    return f"run_now:{schedule_id}:{now_str}"
