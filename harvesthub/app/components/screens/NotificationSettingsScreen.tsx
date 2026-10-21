import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, ActivityIndicator, Alert, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';
import { getPushPermission, registerForPushNotifications, type PushPermission } from '../../lib/pushNotifications';
import type { NotificationSettings } from '../../types/notifications';

type Channel = 'push_enabled' | 'email_enabled' | 'sms_enabled';

// "+12025550123" -> "(202) 555-0123"
function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, '').slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// Which notifications reach the user, and how — shared by the customer and
// farmer apps (routes: app/(customer)/notifications.tsx and
// app/(farmer)/notifications.tsx). Email and text rows only appear once the
// API has those providers set up. Texts are opt-in, with consent asked first.
export default function NotificationSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Channel | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPushPermission().then(setPermission, () => setPermission('unavailable'));
      apiClient.get<NotificationSettings>('/notifications/settings').then(
        (res) => {
          setSettings(res.data);
          setLoadError(null);
        },
        (err) => {
          console.warn('Could not load notification settings:', err);
          setLoadError("Couldn't load your notification settings. Please try again.");
        }
      );
    }, [])
  );

  const save = async (channel: Channel, value: boolean) => {
    if (!settings) return;
    setSaving(channel);
    setSettings({ ...settings, [channel]: value }); // optimistic
    try {
      const res = await apiClient.put<NotificationSettings>('/notifications/settings', { [channel]: value });
      setSettings(res.data);
    } catch (err) {
      setSettings(settings);
      Alert.alert("Couldn't save that", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(null);
    }
  };

  const togglePush = async (value: boolean) => {
    await save('push_enabled', value);
    if (value && permission !== 'granted') {
      const result = await registerForPushNotifications().catch(() => 'denied' as const);
      setPermission(result);
    }
  };

  const toggleSms = (value: boolean) => {
    if (!value || !settings?.sms_phone) {
      save('sms_enabled', value);
      return;
    }
    Alert.alert(
      'Turn on text messages?',
      `HarvestHub will text order updates to ${formatPhone(settings.sms_phone)}. Message and data rates may apply. ` +
        'Message frequency varies. Reply STOP to any text to stop, or turn this off here.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn on', onPress: () => save('sms_enabled', true) },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        {!settings ? (
          loadError ? (
            <Text style={styles.errorText}>{loadError}</Text>
          ) : (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          )
        ) : (
          <>
            <ToggleRow
              icon="notifications-none"
              label="Push notifications"
              caption="Order updates and account news on this phone"
              value={settings.push_enabled}
              onChange={togglePush}
              busy={saving === 'push_enabled'}
            />
            {settings.push_enabled && permission === 'denied' ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Notifications are turned off for HarvestHub in your phone&apos;s settings, so this phone won&apos;t get them.
                </Text>
                <Pressable onPress={() => Linking.openSettings()} hitSlop={8}>
                  <Text style={styles.link}>Open phone settings</Text>
                </Pressable>
              </View>
            ) : null}

            {settings.email_available ? (
              <ToggleRow
                icon="mail-outline"
                label="Email"
                caption="Receipts, order updates and account news"
                value={settings.email_enabled}
                onChange={(v) => save('email_enabled', v)}
                busy={saving === 'email_enabled'}
              />
            ) : null}

            {settings.sms_available ? (
              <ToggleRow
                icon="sms"
                label="Text messages"
                caption={
                  settings.sms_phone
                    ? `Time-sensitive order updates to ${formatPhone(settings.sms_phone)}`
                    : 'Add a US mobile number to your profile to turn these on'
                }
                value={settings.sms_enabled}
                onChange={toggleSms}
                busy={saving === 'sms_enabled'}
                disabled={!settings.sms_phone && !settings.sms_enabled}
              />
            ) : null}

            <Text style={styles.finePrint}>
              Some messages, like sign-in codes and password resets, are always sent by email.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  caption,
  value,
  onChange,
  busy,
  disabled,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  caption: string;
  value: boolean;
  onChange: (value: boolean) => void;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <MaterialIcons name={icon} size={19} color={colors.primary} />
      </View>
      <View style={styles.textWrap}>
        <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={busy || disabled}
        trackColor={{ false: colors.border, true: colors.primaryMid }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.border}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  loading: { marginTop: spacing.xl },
  errorText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md - 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  labelDisabled: { color: colors.textMuted },
  caption: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  notice: { backgroundColor: colors.tint, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  noticeText: { fontSize: 13, lineHeight: 19, color: colors.text },
  link: { fontSize: 13.5, fontWeight: '700', color: colors.primary, marginTop: spacing.xs },
  finePrint: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: spacing.lg },
});
