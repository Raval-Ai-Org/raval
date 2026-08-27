"""003_delivery_logs_post_id_nullable

Revision ID: 003
Revises: 002
Create Date: 2026-08-01 00:00:00.000000

Makes ``delivery_logs.post_id`` nullable. Webhook delivery logs are delivery
metadata, not posts: post events are tied back to their ``post_id`` when the
payload carries one, but generic events legitimately have no post. Before this
change ``webhook_out`` wrote ``post_id=""``, which violated the FK and silently
lost the delivery audit trail (found by the live webhook gate, 2026-08-01).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "delivery_logs",
        "post_id",
        existing_type=sa.String(length=36),
        nullable=True,
    )


def downgrade() -> None:
    # Drop webhook delivery logs without a post before re-enforcing NOT NULL,
    # otherwise the SET NOT NULL would fail on the rows we just made legal.
    op.execute(
        "DELETE FROM delivery_logs "
        "WHERE post_id IS NULL AND event_type LIKE 'webhook.%'"
    )
    op.alter_column(
        "delivery_logs",
        "post_id",
        existing_type=sa.String(length=36),
        nullable=False,
    )
