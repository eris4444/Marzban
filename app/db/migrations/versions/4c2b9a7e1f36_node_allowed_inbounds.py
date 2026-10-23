"""node allowed inbounds

Revision ID: 4c2b9a7e1f36
Revises: 2b231de97dc3
Create Date: 2026-10-23 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4c2b9a7e1f36'
down_revision = '2b231de97dc3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only adds a nullable column: existing nodes get NULL, which means "all inbounds" (old behaviour).
    columns = [c['name'] for c in sa.inspect(op.get_bind()).get_columns('nodes')]
    if 'allowed_inbounds' not in columns:
        op.add_column('nodes', sa.Column('allowed_inbounds', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('nodes') as batch_op:
        batch_op.drop_column('allowed_inbounds')
