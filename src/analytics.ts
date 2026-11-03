import { Capacitor } from "@capacitor/core";
import { FirebaseAnalytics } from "@capacitor-firebase/analytics";

type Params = Record<string, string | number | boolean>;

export function track(name: string, params: Params = {}): void {
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() === "ios" && !Capacitor.isPluginAvailable("FirebaseAnalytics")) return;
  void FirebaseAnalytics.logEvent({ name, params }).catch(() => undefined);
}
