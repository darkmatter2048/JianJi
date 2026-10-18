import { create } from 'zustand'
import type { Vec3 } from '../types'

/** Facts about a loaded model, measured once at import time. */
export interface AssetInfo {
  assetId: string
  meshes: number
  vertices: number
  triangles: number
  /** Size of the source model in its own units, before the viewport fit. */
  size: Vec3
  /** Size in scene units after fitting (longest axis = 2). */
  fittedSize: Vec3
}

interface AssetInfoStore {
  info: Record<string, AssetInfo>
  setInfo: (assetId: string, info: AssetInfo) => void
}

/** Kept apart from the editor store: this is measured data, not user intent. */
export const useAssetInfoStore = create<AssetInfoStore>((set) => ({
  info: {},
  setInfo: (assetId, info) =>
    set((state) => ({ info: { ...state.info, [assetId]: { ...info, assetId } } })),
}))
