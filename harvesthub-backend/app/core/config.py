from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    SUPABASE_URL: str
    STRIPE_SECRET_KEY: str
    STRIPE_WEBHOOK_SECRET: str

    # Server-side Supabase key (Dashboard -> Project Settings -> API keys:
    # the secret / service_role key). Only account deletion uses it, to
    # delete the auth user and their Storage files. Never ship it in the app.
    SUPABASE_SERVICE_ROLE_KEY: str | None = None

    # "production" turns off the interactive API docs (/docs, /redoc).
    ENVIRONMENT: str = "development"
    # Comma-separated browser origins allowed to call the API. The mobile
    # app isn't affected by CORS; this only matters for web pages.
    CORS_ORIGINS: str = "*"

    # Shown on the public legal pages (/privacy, /terms, /delete-account).
    COMPANY_NAME: str = "HarvestHub"  # the registered company name once the LLC exists
    SUPPORT_EMAIL: str = "support@harvesthubmarket.com"
    LEGAL_EFFECTIVE_DATE: str = "October 5, 2026"

    class Config:
        env_file = ".env"

settings = Settings()
