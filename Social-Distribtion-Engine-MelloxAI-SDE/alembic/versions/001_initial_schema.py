"""001_initial_schema

Revision ID: 001
Revises:
Create Date: 2026-07-27 04:55:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create accounts table
    op.create_table(
        'accounts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=255), nullable=False),
        sa.Column('brand_id', sa.String(length=255), nullable=False),
        sa.Column('platform', sa.String(length=50), nullable=False),
        sa.Column('platform_account_id', sa.String(length=255), nullable=False),
        sa.Column('platform_username', sa.String(length=255), nullable=False),
        sa.Column('encrypted_access_token', sa.LargeBinary(), nullable=False),
        sa.Column('encrypted_refresh_token', sa.LargeBinary(), nullable=True),
        sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='active'),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', 'platform', 'platform_account_id', name='uq_accounts_workspace_platform_account')
    )
    op.create_index('ix_accounts_workspace_id', 'accounts', ['workspace_id'])
    op.create_index('ix_accounts_status', 'accounts', ['status'])
    op.create_index('ix_accounts_token_expires_at_status', 'accounts',
                   ['token_expires_at'],
                   postgresql_where=sa.text("status = 'active'"))

    # Create posts table
    op.create_table(
        'posts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=255), nullable=False),
        sa.Column('brand_id', sa.String(length=255), nullable=False),
        sa.Column('idempotency_key', sa.String(length=128), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='pending'),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', 'idempotency_key', name='uq_posts_workspace_idempotency_key')
    )
    op.create_index('ix_posts_workspace_id', 'posts', ['workspace_id'])
    op.create_index('ix_posts_status', 'posts', ['status'])
    op.create_index('ix_posts_scheduled_at_status', 'posts',
                   ['scheduled_at'],
                   postgresql_where=sa.text("status = 'pending'"))

    # Create post_targets table
    op.create_table(
        'post_targets',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('post_id', sa.String(length=36), nullable=False),
        sa.Column('account_id', sa.String(length=36), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='pending'),
        sa.Column('content', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('platform_post_id', sa.String(length=255), nullable=True),
        sa.Column('platform_post_url', sa.String(length=512), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('max_attempts', sa.Integer(), nullable=False, server_default='5'),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error_category', sa.String(length=50), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['post_id'], ['posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_post_targets_post_id', 'post_targets', ['post_id'])
    op.create_index('ix_post_targets_account_id', 'post_targets', ['account_id'])
    op.create_index('ix_post_targets_status', 'post_targets', ['status'])
    op.create_index('ix_post_targets_status_next_attempt_at', 'post_targets',
                   ['status', 'next_attempt_at'])

    # Create webhook_endpoints table
    op.create_table(
        'webhook_endpoints',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=255), nullable=False),
        sa.Column('url', sa.String(length=512), nullable=False),
        sa.Column('secret', sa.String(length=128), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='active'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', 'url', name='uq_webhook_endpoints_workspace_url')
    )
    op.create_index('ix_webhook_endpoints_workspace_id', 'webhook_endpoints', ['workspace_id'])
    op.create_index('ix_webhook_endpoints_status', 'webhook_endpoints', ['status'])

    # Create delivery_logs table
    op.create_table(
        'delivery_logs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('post_id', sa.String(length=36), nullable=False),
        sa.Column('post_target_id', sa.String(length=36), nullable=True),
        sa.Column('workspace_id', sa.String(length=255), nullable=False),
        sa.Column('event_type', sa.String(length=50), nullable=False),
        sa.Column('http_status', sa.Integer(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['post_id'], ['posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['post_target_id'], ['post_targets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_delivery_logs_post_id', 'delivery_logs', ['post_id'])
    op.create_index('ix_delivery_logs_post_target_id', 'delivery_logs', ['post_target_id'])
    op.create_index('ix_delivery_logs_workspace_id', 'delivery_logs', ['workspace_id'])
    op.create_index('ix_delivery_logs_event_type', 'delivery_logs', ['event_type'])
    op.create_index('ix_delivery_logs_created_at', 'delivery_logs', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_delivery_logs_created_at', 'delivery_logs')
    op.drop_index('ix_delivery_logs_event_type', 'delivery_logs')
    op.drop_index('ix_delivery_logs_workspace_id', 'delivery_logs')
    op.drop_index('ix_delivery_logs_post_target_id', 'delivery_logs')
    op.drop_index('ix_delivery_logs_post_id', 'delivery_logs')
    op.drop_table('delivery_logs')

    op.drop_index('ix_webhook_endpoints_status', 'webhook_endpoints')
    op.drop_index('ix_webhook_endpoints_workspace_id', 'webhook_endpoints')
    op.drop_table('webhook_endpoints')

    op.drop_index('ix_post_targets_status_next_attempt_at', 'post_targets')
    op.drop_index('ix_post_targets_status', 'post_targets')
    op.drop_index('ix_post_targets_account_id', 'post_targets')
    op.drop_index('ix_post_targets_post_id', 'post_targets')
    op.drop_table('post_targets')

    op.drop_index('ix_posts_scheduled_at_status', 'posts')
    op.drop_index('ix_posts_status', 'posts')
    op.drop_index('ix_posts_workspace_id', 'posts')
    op.drop_table('posts')

    op.drop_index('ix_accounts_token_expires_at_status', 'accounts')
    op.drop_index('ix_accounts_status', 'accounts')
    op.drop_index('ix_accounts_workspace_id', 'accounts')
    op.drop_table('accounts')
