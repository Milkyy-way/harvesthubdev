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

    # --- Notifications (app/notifications/). Each channel stays off, quietly,
    # until its key is set — so development works with none of them.
    # Email via Resend (resend.com): API key, and a From address on a domain
    # verified in Resend.
    RESEND_API_KEY: str | None = None
    EMAIL_FROM: str = "HarvestHub <no-reply@harvesthubmarket.com>"
    # Text messages via Telnyx (telnyx.com): API key and the sending number
    # (+1..., registered for 10DLC or toll-free verified — see LAUNCH_ANDROID.md).
    TELNYX_API_KEY: str | None = None
    TELNYX_FROM_NUMBER: str | None = None
    # Push via Expo's push service. Optional: only needed if "enhanced push
    # security" is switched on for the project at expo.dev.
    EXPO_ACCESS_TOKEN: str | None = None
    # Shared secret for the scheduled-jobs endpoint (POST /internal/jobs/run),
    # sent by Cloud Scheduler in the X-Cron-Secret header. Unset = endpoint off.
    CRON_SECRET: str | None = None

    # Google Maps Platform key, server only (never in the app): address
    # suggestions while typing (Places API (New), proxied by /addresses/*) and
    # geocoding (Geocoding API). Unset = no suggestions, and the free
    # Census/ZIP geocoders (less exact).
    GOOGLE_MAPS_API_KEY: str | None = None

    # Shown on the public legal pages (/privacy, /terms, /delete-account).
    COMPANY_NAME: str = "HarvestHub"  # the registered company name once the LLC exists
    SUPPORT_EMAIL: str = "support@harvesthubmarket.com"
    LEGAL_EFFECTIVE_DATE: str = "October 5, 2026"

    # Where the shared app link (/app) sends people. IOS_APP_URL stays unset
    # until the iPhone app is in the App Store; until then iPhones get a page
    # that says it's coming.
    ANDROID_APP_URL: str = "https://play.google.com/store/apps/details?id=com.harvesthubmarket.app"
    IOS_APP_URL: str | None = None

    class Config:
        env_file = ".env"

settings = Settings()
