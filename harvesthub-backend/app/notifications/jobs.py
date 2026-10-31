"""Notifications nothing in the API triggers directly, found by looking:
  * the free Harvest Pass period ending in the next 3 days, or just ended;
  * a farmer application approved or rejected (done in Supabase Studio);
  * a payout marked paid (also done in Studio).

POST /internal/jobs/run (app/jobs/router.py) calls run(); Cloud Scheduler
hits it every 15 minutes (see LAUNCH_ANDROID.md). Safe to run any number of
times: every notice has a dedupe key, so each event is sent once.

Look-back windows are short on purpose — the first run after deploying
mustn't message people about things that happened weeks ago.
"""
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.membership import service as membership_service
from app.notifications.service import Notice, notify_many
from app.pods.models import PodMember

_ALREADY_SENT = "not exists (select 1 from notifications n where n.dedupe_key = {key})"


def run(db: Session) -> dict:
    counts = {
        "free_period_ending": _free_period_ending(db),
        "free_period_ended": _free_period_ended(db),
        "farmer_reviews": _farmer_reviews(db),
        "payouts_sent": _payouts_sent(db),
    }
    return counts


def _free_period_ending(db: Session) -> int:
    rows = db.execute(
        text(
            f"""
            select fp.customer_id, fp.ends_at
            from harvest_pass_free_periods fp
            join profiles p on p.id = fp.customer_id and p.status = 'active'
            where fp.ends_at > now() and fp.ends_at <= now() + interval '3 days'
              and {_ALREADY_SENT.format(key="'free_period_ending:' || fp.customer_id")}
            """
        )
    ).all()
    notices = []
    for customer_id, ends_at in rows:
        membership = membership_service.live_membership(db, customer_id)
        if membership and membership.status == "active":
            continue  # already paying — nothing about the free period to tell them
        joined = membership is not None and membership.status == "trialing" and not membership.cancel_at_period_end
        notices.append(
            Notice(
                customer_id,
                "free_period_ending",
                {
                    "ends_at": ends_at,
                    "joined": joined,
                    "first_charge": float(membership.price_amount) if joined else None,
                    "in_pod": db.query(PodMember.id).filter(PodMember.customer_id == customer_id, PodMember.status == "active").first()
                    is not None,
                },
                dedupe_key=f"free_period_ending:{customer_id}",
            )
        )
    notify_many(db, notices)
    return len(notices)


def _free_period_ended(db: Session) -> int:
    rows = db.execute(
        text(
            f"""
            select fp.customer_id
            from harvest_pass_free_periods fp
            join profiles p on p.id = fp.customer_id and p.status = 'active'
            where fp.ends_at <= now() and fp.ends_at > now() - interval '3 days'
              and {_ALREADY_SENT.format(key="'free_period_ended:' || fp.customer_id")}
            """
        )
    ).all()
    notices = [
        Notice(customer_id, "free_period_ended", {}, dedupe_key=f"free_period_ended:{customer_id}")
        for (customer_id,) in rows
        if not membership_service.has_member_benefits(db, customer_id)  # joined, so it carried straight on
    ]
    notify_many(db, notices)
    return len(notices)


def _farmer_reviews(db: Session) -> int:
    # One notice per decision per submission: a farmer who's rejected,
    # resubmits (new submitted_at) and is then approved hears both times.
    key = "'farmer_review:' || fv.id || ':' || fv.status || ':' || coalesce(fv.submitted_at::text, '')"
    rows = db.execute(
        text(
            f"""
            select fv.id, fv.status, fv.reviewer_notes, fp.farm_name, {key} as dedupe_key
            from farmer_verification fv
            join profiles p on p.id = fv.id and p.status <> 'deleted'
            left join farmer_profiles fp on fp.id = fv.id
            where fv.status in ('approved', 'rejected')
              and fv.updated_at > now() - interval '3 days'
              and {_ALREADY_SENT.format(key=key)}
            """
        )
    ).all()
    notices = [
        Notice(
            farmer_id,
            "farmer_approved" if review_status == "approved" else "farmer_rejected",
            {"farm_name": farm_name, "reviewer_notes": reviewer_notes},
            dedupe_key=dedupe_key,
        )
        for farmer_id, review_status, reviewer_notes, farm_name, dedupe_key in rows
    ]
    notify_many(db, notices)
    return len(notices)


def _payouts_sent(db: Session) -> int:
    rows = db.execute(
        text(
            f"""
            select fp.id, fp.farmer_id, fp.net_total, fp.pay_period_start, fp.pay_period_end
            from farmer_payouts fp
            where fp.status = 'paid' and fp.net_total > 0
              and coalesce(fp.disbursed_at, fp.updated_at) > now() - interval '7 days'
              and {_ALREADY_SENT.format(key="'payout_sent:' || fp.id")}
            """
        )
    ).all()
    notices = [
        Notice(
            farmer_id,
            "payout_sent",
            {"amount": float(net_total), "period_start": start, "period_end": end},
            dedupe_key=f"payout_sent:{payout_id}",
        )
        for payout_id, farmer_id, net_total, start, end in rows
    ]
    notify_many(db, notices)
    return len(notices)
