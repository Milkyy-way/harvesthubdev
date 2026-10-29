import { useCallback, useEffect, useRef } from 'react';
import { View, Platform, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker } from 'react-native-maps';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, radius } from '../../constants/theme';

type Point = { latitude: number; longitude: number };

// Android draws this map with Google Maps, which needs the app's Maps SDK key
// (app.config.ts, GOOGLE_MAPS_ANDROID_API_KEY); without one, MapView would
// crash, so callers show the arrival estimate as text instead. iPhones use
// Apple Maps, no key.
export const LIVE_MAP_AVAILABLE =
  Platform.OS !== 'android' || Boolean(Constants.expoConfig?.android?.config?.googleMaps?.apiKey);

// The farmer on their way to the customer: two markers, kept in view as the
// farmer's position updates. Only ever shown to the customer who's next.
export function LiveDeliveryMap({ farmer, destination, farmName }: { farmer: Point; destination: Point | null; farmName: string }) {
  const mapRef = useRef<MapView>(null);

  const frame = useCallback(() => {
    if (destination) {
      mapRef.current?.fitToCoordinates([farmer, destination], {
        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
        animated: true,
      });
    } else {
      mapRef.current?.animateCamera({ center: farmer, zoom: 15 });
    }
  }, [farmer, destination]);

  useEffect(() => {
    frame();
  }, [frame]);

  if (!LIVE_MAP_AVAILABLE) return null;

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{ ...farmer, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        onMapReady={frame}
        toolbarEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        accessibilityLabel={`Map showing ${farmName} on the way to you`}
      >
        <Marker coordinate={farmer} title={farmName} description="On the way to you">
          <View style={styles.truck}>
            <MaterialIcons name="local-shipping" size={18} color={colors.white} />
          </View>
        </Marker>
        {destination ? (
          <Marker coordinate={destination} title="Your delivery">
            <View style={styles.home}>
              <MaterialIcons name="home" size={18} color={colors.primary} />
            </View>
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.md, overflow: 'hidden', marginTop: 12, backgroundColor: colors.border },
  map: { width: '100%', height: 220 },
  truck: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  home: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
