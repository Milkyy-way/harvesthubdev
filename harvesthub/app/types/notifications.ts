// Matches harvesthub-backend/app/notifications/schemas.py.

export interface NotificationSettings {
  push_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  email_available: boolean; // false until the API has an email provider set up
  sms_available: boolean; // false until the API has an SMS provider set up
  sms_phone: string | null; // +1..., where texts go; null if the profile has no US number
}
