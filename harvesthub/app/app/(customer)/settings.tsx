import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, fonts } from '../../constants/theme';
import { SettingsRow } from '../../components/customer/SettingsRow';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <SettingsRow
          icon="edit"
          label="Edit Profile"
          caption="Name, phone, address, preferences"
          onPress={() => router.push('/(customer)/edit-profile')}
        />
        <SettingsRow
          icon="card-giftcard"
          label="Refer a friend"
          caption="Give a month of Harvest Pass, get a month"
          onPress={() => router.push('/(customer)/referral')}
        />
        <SettingsRow icon="gavel" label="Legal" caption="Terms of Service, Privacy Policy" onPress={() => router.push('/(customer)/legal')} />
        <SettingsRow
          icon="person-remove"
          label="Delete account"
          caption="Permanently delete your account and data"
          onPress={() => router.push('/(customer)/delete-account')}
          destructive
        />
      </ScrollView>
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
  content: { padding: spacing.lg },
});
