from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.account.router import router as account_router
from app.customers.router import router as customers_router
from app.categories.router import router as categories_router
from app.farmers.router import router as farmers_router
from app.products.router import router as products_router
from app.cart.router import router as cart_router
from app.checkout.router import router as checkout_router
from app.orders.router import router as orders_router
from app.webhooks.router import router as webhooks_router
from app.farmer_products.router import router as farmer_products_router
from app.farmer_orders.router import router as farmer_orders_router
from app.farmer_earnings.router import router as farmer_earnings_router
from app.farmer_ratings.router import router as farmer_ratings_router
from app.legal.router import router as legal_router
from app.membership.router import router as membership_router
from app.notifications.router import router as notifications_router
from app.addresses.router import router as addresses_router
from app.jobs.router import router as jobs_router
from app.delivery.router import customer_router as delivery_router
from app.delivery.router import farmer_router as farmer_delivery_router
from app.pods.router import router as pods_router

# The interactive docs list every endpoint — handy in development, not
# something to publish in production.
_docs_enabled = settings.ENVIRONMENT != "production"

app = FastAPI(
    title="HarvestHub API",
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(account_router, prefix="/api/v1")
app.include_router(customers_router, prefix="/api/v1")
app.include_router(categories_router, prefix="/api/v1")
app.include_router(farmers_router, prefix="/api/v1")
app.include_router(products_router, prefix="/api/v1")
app.include_router(cart_router, prefix="/api/v1")
app.include_router(checkout_router, prefix="/api/v1")
app.include_router(orders_router, prefix="/api/v1")
app.include_router(webhooks_router, prefix="/api/v1")
app.include_router(farmer_products_router, prefix="/api/v1")
app.include_router(farmer_orders_router, prefix="/api/v1")
app.include_router(farmer_earnings_router, prefix="/api/v1")
app.include_router(farmer_ratings_router, prefix="/api/v1")
app.include_router(membership_router, prefix="/api/v1")
app.include_router(notifications_router, prefix="/api/v1")
app.include_router(addresses_router, prefix="/api/v1")
app.include_router(jobs_router, prefix="/api/v1")
app.include_router(delivery_router, prefix="/api/v1")
app.include_router(farmer_delivery_router, prefix="/api/v1")
app.include_router(pods_router, prefix="/api/v1")
app.include_router(legal_router)

@app.get("/health")
def health():
    return {"status": "ok"}
