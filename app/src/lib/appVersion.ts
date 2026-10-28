// Which version of the store app a parent's phone runs, and whether the store
// has a newer one (system/app, written by the worker's store lookup). The
// phone reports its version (lib/deviceReport.ts); family see it in Settings
// (ParentAppStatus) and may send an update notice; the phone itself shows a
// banner while it is behind.

import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { storeUrlFor } from './storeLinks'
import type { ElderDevice } from '../types'

export type AppPlatform = 'ios' | 'android'

export interface NativeAppInfo {
  version: string
  build: string
  platform: AppPlatform
}

/** The latest version in each store; a platform is missing until it is known. */
export type StoreVersions = Partial<Record<AppPlatform, string>>

/** Numeric x.y.z order: compareVersions('1.0.2', '1.0.10') < 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Behind the store only when both versions are known: an unknown version
 *  never asks anyone to update. */
export function isBehind(current: string | undefined, latest: string | undefined): boolean {
  return !!current && !!latest && compareVersions(current, latest) < 0
}

export type AppStatus =
  | { kind: 'none' }
  | { kind: 'unknown'; platform: 'ios' | 'android' }
  | { kind: 'behind'; platform: 'ios' | 'android'; version: string }
  | { kind: 'current'; platform: 'ios' | 'android'; version: string }

/** What family see about the parent's linked phone. A phone linked through
 *  the website has no store app, so nothing is said about it. */
export function appStatus(device: ElderDevice | undefined, latest: StoreVersions): AppStatus {
  if (!device || (device.platform !== 'ios' && device.platform !== 'android')) return { kind: 'none' }
  const platform = device.platform
  const version = device.app?.version
  // Phones from before 1.0.4 never report a version.
  if (!version) return { kind: 'unknown', platform }
  // The store's version isn't known (yet): say nothing rather than "최신 버전".
  if (!latest[platform]) return { kind: 'none' }
  return isBehind(version, latest[platform]) ? { kind: 'behind', platform, version } : { kind: 'current', platform, version }
}

/** This phone's app version, or null on the website. */
export async function nativeAppInfo(): Promise<NativeAppInfo | null> {
  const platform = Capacitor.getPlatform()
  if (!Capacitor.isNativePlatform() || (platform !== 'ios' && platform !== 'android')) return null
  try {
    const { version, build } = await CapApp.getInfo()
    return { version, build, platform }
  } catch (err) {
    console.warn('[app-version] no app info', err)
    return null
  }
}

/** The store page for a phone of this kind, or null when there is none yet. */
export function storeUrlForPlatform(platform: string | undefined): string | null {
  return platform === 'ios' || platform === 'android' ? storeUrlFor(platform) : null
}

/** Open the store page; the installed apps hand `_blank` to the phone, which
 *  opens the App Store or Play. */
export function openStore(url: string | null | undefined): void {
  if (url) window.open(url, '_blank', 'noopener')
}

const REPORTED_KEY = 'tbp.device.reported'
const DAY_MS = 24 * 60 * 60 * 1000

/** Report again on a new version, or once a day to keep the record fresh. */
export function shouldReport(stored: string | null, version: string, now: number): boolean {
  if (!stored) return true
  const [v, at] = stored.split(':')
  return v !== version || !(now - Number(at) < DAY_MS)
}

export function lastReported(): string | null {
  try { return localStorage.getItem(REPORTED_KEY) } catch { return null }
}

export function rememberReported(version: string, now: number): void {
  try { localStorage.setItem(REPORTED_KEY, `${version}:${now}`) } catch { /* private mode */ }
}
