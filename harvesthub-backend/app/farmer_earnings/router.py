from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.farmers.service import get_current_farmer
from app.farmer_earnings import service, statements
from app.farmer_earnings.schemas import FarmerEarningsOut, OrderStatementOut, StatementLinkOut, TransactionsOut

# The farmer app's Earnings screen (Farmer F4) — read-only, on top of the
# payout ledger (farmer_ledger_entries / farmer_payouts).
router = APIRouter(prefix="/farmers/me/earnings", tags=["farmer earnings"])


@router.get("", response_model=FarmerEarningsOut)
def read_my_earnings(db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.get_farmer_earnings(db, farmer.id)


# Transactions and statements (2026-11-22): every sale, refund, charge and
# payout; one order's statement; and a weekly statement page.
@router.get("/transactions", response_model=TransactionsOut)
def read_my_transactions(
    kind: str = Query("all"),
    before: str | None = Query(None),
    db: Session = Depends(get_db),
    farmer=Depends(get_current_farmer),
):
    return statements.transactions(db, farmer.id, kind, before)


@router.get("/orders/{store_order_id}", response_model=OrderStatementOut)
def read_order_statement(store_order_id: str, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return statements.order_statement(db, farmer.id, store_order_id)


@router.post("/statements/{period_start}/link", response_model=StatementLinkOut)
def make_statement_link(period_start: str, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    # A 30-minute link the app opens in the browser (which can't send the
    # app's sign-in): print or save as PDF, or download the spreadsheet.
    return statements.statement_link(db, farmer.id, period_start)


# The weekly statement itself, at the API's root (not /api/v1), by signed link.
public_router = APIRouter(prefix="/statements", include_in_schema=False)


@public_router.get("/{token}", response_class=HTMLResponse)
def weekly_statement_page(token: str, db: Session = Depends(get_db)):
    farmer_id, start = statements.read_token(token)
    page = statements.statement_html(statements.weekly_statement(db, farmer_id, start), token)
    return HTMLResponse(page, headers={"Cache-Control": "private, no-store", "X-Robots-Tag": "noindex"})


@public_router.get("/{token}/csv")
def weekly_statement_csv(token: str, db: Session = Depends(get_db)):
    farmer_id, start = statements.read_token(token)
    body = statements.statement_csv(statements.weekly_statement(db, farmer_id, start))
    return Response(
        body,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="harvesthub-statement-{start.isoformat()}.csv"',
            "Cache-Control": "private, no-store",
        },
    )
