import {
  AdMob,
  AdmobConsentStatus,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from "@capacitor-community/admob";
import { Capacitor } from "@capacitor/core";
import { FirebaseRemoteConfig, GetValueSource } from "@capacitor-firebase/remote-config";
import { track } from "./analytics";
import { t } from "./i18n";

export type AdKind = "interstitial" | "rewarded";
export type AdResult = { watched: boolean };
export type RewardOutcome = "granted" | "cancelled" | "unavailable";

/** Live AdMob units unless the web bundle is built with VITE_TEST_ADS=1. */
export const USE_TEST_ADS = import.meta.env.VITE_TEST_ADS === "1";

const LIVE = {
  banner: "ca-app-pub-5137687081452427/6904620930",
  rewarded: "ca-app-pub-5137687081452427/7490765711",
  interstitial: "ca-app-pub-5137687081452427/6144683005",
};

const TEST = {
  banner: "ca-app-pub-3940256099942544/6300978111",
  rewarded: "ca-app-pub-3940256099942544/5224354917",
  interstitial: "ca-app-pub-3940256099942544/1033173712",
};

/** Firebase Remote Config keys. Local values apply until a fetch succeeds. */
const FLAGS = {
  ads_enabled: true,
  banner_enabled: true,
  interstitial_enabled: true,
  rewarded_enabled: true,
  double_coins_enabled: true,
};
const NUMBERS = {
  interstitial_every: 4,
  interstitial_min_seconds: 90,
  interstitial_start_level: 5,
  banner_start_level: 4,
};
type Flag = keyof typeof FLAGS;
type Num = keyof typeof NUMBERS;

type Host = {
  show: (kind: AdKind, title: string, body: string) => Promise<AdResult>;
};

type Slot = { loadedAt: number; loading: Promise<boolean> | null; fails: number; retry: number };

type Active = {
  kind: AdKind;
  showed: () => void;
  earned: () => void;
  dismissed: () => void;
  failed: () => void;
};

/** AdMob cached ads expire after an hour. */
const AD_TTL_MS = 50 * 60 * 1000;
const SHOW_TIMEOUT_MS = 6000;
const PACING_KEY = "glow-jars-ads-v1";

let host: Host | null = null;
let nativeReady = false;
const flags: Record<Flag, boolean> = { ...FLAGS };
const numbers: Record<Num, number> = { ...NUMBERS };
let bannerLevel: number | null = null;
let bannerShown = false;
let bannerBusy: Promise<void> = Promise.resolve();
let privacyRequired = false;
let active: Active | null = null;
const slots: Record<AdKind, Slot> = {
  interstitial: { loadedAt: 0, loading: null, fails: 0, retry: 0 },
  rewarded: { loadedAt: 0, loading: null, fails: 0, retry: 0 },
};
const pacing = loadPacing();

export function bindAds(next: Host): void {
  host = next;
}

function units() {
  return USE_TEST_ADS ? TEST : LIVE;
}

function allowed(kind: "banner" | AdKind): boolean {
  return flags.ads_enabled && flags[`${kind}_enabled`];
}

function loadPacing(): { wins: number; last: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(PACING_KEY) ?? "{}") as { wins?: unknown; last?: unknown };
    return {
      wins: typeof raw.wins === "number" ? raw.wins : 0,
      last: typeof raw.last === "number" ? raw.last : 0,
    };
  } catch {
    return { wins: 0, last: 0 };
  }
}

function savePacing(): void {
  try {
    localStorage.setItem(PACING_KEY, JSON.stringify(pacing));
  } catch {
    /* storage full — pacing resets next launch */
  }
}

function setBannerInset(px: number): void {
  const next = `${Math.max(0, Math.round(px))}px`;
  const root = document.documentElement.style;
  if (root.getPropertyValue("--banner-h") === next) return;
  root.setProperty("--banner-h", next);
  // Board rects refresh on the next frame; re-run layout listeners (coach spotlight) after that.
  requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))));
}

async function readConfig(): Promise<void> {
  for (const key of Object.keys(FLAGS) as Flag[]) {
    try {
      const { value, source } = await FirebaseRemoteConfig.getBoolean({ key });
      flags[key] = source === GetValueSource.Remote ? value : FLAGS[key];
    } catch {
      flags[key] = FLAGS[key];
    }
  }
  for (const key of Object.keys(NUMBERS) as Num[]) {
    try {
      const { value, source } = await FirebaseRemoteConfig.getNumber({ key });
      numbers[key] = source === GetValueSource.Remote && Number.isFinite(value) && value >= 0 ? value : NUMBERS[key];
    } catch {
      numbers[key] = NUMBERS[key];
    }
  }
}

function onConfig(): void {
  syncBanner();
  preloadAll();
}

async function initRemoteConfig(): Promise<void> {
  try {
    await FirebaseRemoteConfig.setSettings({
      minimumFetchIntervalInSeconds: 3600,
      fetchTimeoutInSeconds: 10,
    });
    await FirebaseRemoteConfig.activate();
    await readConfig();
    void FirebaseRemoteConfig.fetchAndActivate()
      .then(readConfig)
      .then(onConfig)
      .catch(() => undefined);
    await FirebaseRemoteConfig.addConfigUpdateListener((event) => {
      if (!event) return;
      void FirebaseRemoteConfig.activate()
        .then(readConfig)
        .then(onConfig)
        .catch(() => undefined);
    });
  } catch {
    /* Remote Config unavailable — keep local values */
  }
}

/** UMP: shows the GDPR/US-states form when the user's region requires it. */
async function gatherConsent(): Promise<void> {
  try {
    let info = await AdMob.requestConsentInfo();
    if (info.status === AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable) {
      info = await AdMob.showConsentForm();
    }
    privacyRequired = info.status !== AdmobConsentStatus.NOT_REQUIRED && Boolean(info.isConsentFormAvailable);
  } catch {
    privacyRequired = false;
  }
}

function bindFullscreenEvents(): Promise<unknown> {
  const on = (event: string, fn: (a: Active) => void) =>
    AdMob.addListener(event as never, () => {
      if (active) fn(active);
    });
  return Promise.all([
    on(InterstitialAdPluginEvents.Showed, (a) => a.kind === "interstitial" && a.showed()),
    on(InterstitialAdPluginEvents.Dismissed, (a) => a.kind === "interstitial" && a.dismissed()),
    on(InterstitialAdPluginEvents.FailedToShow, (a) => a.kind === "interstitial" && a.failed()),
    on(RewardAdPluginEvents.Showed, (a) => a.kind === "rewarded" && a.showed()),
    on(RewardAdPluginEvents.Rewarded, (a) => a.kind === "rewarded" && a.earned()),
    on(RewardAdPluginEvents.Dismissed, (a) => a.kind === "rewarded" && a.dismissed()),
    on(RewardAdPluginEvents.FailedToShow, (a) => a.kind === "rewarded" && a.failed()),
  ]);
}

export async function initAds(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await initRemoteConfig();
  try {
    await AdMob.initialize({ initializeForTesting: USE_TEST_ADS });
    await gatherConsent();
    await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => {
      setBannerInset(bannerShown ? size.height : 0);
    });
    await bindFullscreenEvents();
    nativeReady = true;
  } catch {
    nativeReady = false;
  }
  onConfig();
}

export function privacyOptionsRequired(): boolean {
  return privacyRequired;
}

export async function openPrivacyOptions(): Promise<void> {
  if (!nativeReady) return;
  try {
    await AdMob.resetConsentInfo();
    const info = await AdMob.requestConsentInfo();
    if (info.isConsentFormAvailable) await AdMob.showConsentForm();
  } catch {
    /* form unavailable — nothing to change */
  }
}

function bannerWanted(): boolean {
  return bannerLevel !== null && bannerLevel >= numbers.banner_start_level;
}

function syncBanner(): void {
  bannerBusy = bannerBusy.then(applyBanner, applyBanner);
}

async function applyBanner(): Promise<void> {
  const want = bannerWanted() && nativeReady && allowed("banner");
  try {
    if (want && !bannerShown) {
      await AdMob.showBanner({
        adId: units().banner,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        margin: 0,
        isTesting: USE_TEST_ADS,
      });
      bannerShown = true;
    } else if (!want && bannerShown) {
      await AdMob.removeBanner();
      bannerShown = false;
    }
  } catch {
    bannerShown = false;
  }
  if (!bannerShown) setBannerInset(0);
}

/** Banner only lives on the play screen, from `banner_start_level` on. Pass null off the play screen. */
export function setPlayBanner(level: number | null): void {
  if (bannerLevel === level) return;
  bannerLevel = level;
  syncBanner();
}

function isLoaded(kind: AdKind): boolean {
  const at = slots[kind].loadedAt;
  return at > 0 && Date.now() - at < AD_TTL_MS;
}

function preload(kind: AdKind): Promise<boolean> {
  const slot = slots[kind];
  if (!nativeReady || !allowed(kind)) return Promise.resolve(false);
  if (isLoaded(kind)) return Promise.resolve(true);
  if (slot.loading) return slot.loading;
  window.clearTimeout(slot.retry);
  const options = { adId: units()[kind], isTesting: USE_TEST_ADS };
  const request = kind === "interstitial" ? AdMob.prepareInterstitial(options) : AdMob.prepareRewardVideoAd(options);
  slot.loading = request
    .then(() => {
      slot.loadedAt = Date.now();
      slot.fails = 0;
      return true;
    })
    .catch(() => {
      slot.loadedAt = 0;
      slot.fails += 1;
      const wait = Math.min(300, 15 * 2 ** (slot.fails - 1)) * 1000;
      slot.retry = window.setTimeout(() => void preload(kind), wait);
      return false;
    })
    .finally(() => {
      slot.loading = null;
    });
  return slot.loading;
}

function preloadAll(): void {
  void preload("rewarded");
  void preload("interstitial");
}

/** Resolves once the ad is closed. `shown` is false when it never reached the screen. */
function present(kind: AdKind): Promise<{ shown: boolean; earned: boolean }> {
  return new Promise((resolve) => {
    let earned = false;
    let settled = false;
    const finish = (shown: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      active = null;
      resolve({ shown, earned });
      void preload(kind);
    };
    const timer = window.setTimeout(() => finish(false), SHOW_TIMEOUT_MS);
    active = {
      kind,
      showed: () => window.clearTimeout(timer),
      earned: () => {
        earned = true;
      },
      // The reward callback can land just after dismissal.
      dismissed: () => window.setTimeout(() => finish(true), 300),
      failed: () => finish(false),
    };
    slots[kind].loadedAt = 0;
    const call = kind === "interstitial" ? AdMob.showInterstitial() : AdMob.showRewardVideoAd();
    call.then(
      () => {
        if (kind === "rewarded") earned = true;
      },
      () => finish(false),
    );
  });
}

async function mock(kind: AdKind, title: string, body: string): Promise<AdResult> {
  if (!host) return { watched: kind !== "rewarded" };
  return host.show(kind, title, body);
}

/** Call once per cleared level, before `maybeInterstitial`. */
export function noteLevelCleared(): void {
  pacing.wins += 1;
  savePacing();
}

/** Shows an interstitial only when level, win count and cooldown all allow it. */
export async function maybeInterstitial(level: number): Promise<boolean> {
  if (!allowed("interstitial")) return false;
  if (level < numbers.interstitial_start_level) return false;
  if (pacing.wins < Math.max(1, numbers.interstitial_every)) return false;
  if (Date.now() - pacing.last < numbers.interstitial_min_seconds * 1000) return false;

  if (!Capacitor.isNativePlatform()) {
    await mock("interstitial", t("adTitle"), t("adMockBody"));
  } else {
    if (!nativeReady || !isLoaded("interstitial")) {
      track("ad_unavailable", { format: "interstitial", level });
      void preload("interstitial");
      return false;
    }
    const { shown } = await present("interstitial");
    if (!shown) {
      track("ad_unavailable", { format: "interstitial", level });
      return false;
    }
  }
  pacing.wins = 0;
  pacing.last = Date.now();
  savePacing();
  track("ad_show", { format: "interstitial", level });
  return true;
}

export function doubleCoinsEnabled(): boolean {
  return allowed("rewarded") && flags.double_coins_enabled;
}

/** When rewarded ads are switched off remotely, the reward is granted without an ad. */
export async function showRewarded(reason: string, placement: string): Promise<RewardOutcome> {
  if (!allowed("rewarded")) return "granted";
  let outcome: RewardOutcome;
  if (!Capacitor.isNativePlatform()) {
    outcome = (await mock("rewarded", t("adRewardTitle"), reason)).watched ? "granted" : "cancelled";
  } else if (!nativeReady || !(await preload("rewarded"))) {
    outcome = "unavailable";
  } else {
    const { shown, earned } = await present("rewarded");
    outcome = !shown ? "unavailable" : earned ? "granted" : "cancelled";
    if (shown) {
      pacing.last = Date.now();
      savePacing();
    }
  }
  if (outcome === "granted") track("reward_granted", { placement });
  else if (outcome === "cancelled") track("reward_cancelled", { placement });
  else track("ad_unavailable", { format: "rewarded", placement });
  return outcome;
}
