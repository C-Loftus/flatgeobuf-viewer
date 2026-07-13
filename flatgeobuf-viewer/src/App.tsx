import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  Cloud,
  Copy,
  FileUp,
  Layers,
  Loader2,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Search,
  TableProperties,
} from 'lucide-react'
import maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import FlatGeobuf from 'mapbox-gl-flatgeobuf'
import { geojson } from 'flatgeobuf'
import type { HeaderMeta } from 'flatgeobuf/lib/mjs/header-meta.js'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

type BBox = [number, number, number, number]

type Geometry = {
  type: string
  coordinates: unknown
}

type Feature = {
  type: 'Feature'
  id?: string | number
  geometry: Geometry | null
  properties: Record<string, unknown> | null
}

type FeatureCollection = {
  type: 'FeatureCollection'
  features: Feature[]
}

type DatasetSource =
  | { kind: 'url'; url: string }
  | { kind: 'file'; name: string; bytes: Uint8Array; objectUrl: string }

type FlatGeobufInstance = {
  destroySource: () => void
  disableRequests: () => void
  enableRequests: () => void
}

type MetadataRow = {
  key: string
  value: string
}

type Basemap = 'standard' | 'satellite'

const SAMPLE_URL = 'https://flatgeobuf.org/test/data/UScounties.fgb'
const DEFAULT_FEATURE_LIMIT = 1000
const QUERY_PIXELS = 150
const WORLD_BBOX: BBox = [-180, -90, 180, 90]
const COLORADO_BBOX: BBox = [-109.2, 36.85, -101.85, 41.15]
const COLORADO_BBOX_TEXT = '-109.2, 36.85, -101.85, 41.15'
const DISPLAY_CRS = 'EPSG:4326'
const SOURCE_ID = 'fgb-tiled-source'
const PREVIEW_SOURCE_ID = 'fgb-preview-source'
const SELECTED_SOURCE_ID = 'fgb-selected-source'
const FILL_LAYER_ID = 'fgb-preview-fill'
const LINE_LAYER_ID = 'fgb-preview-line'
const POINT_LAYER_ID = 'fgb-preview-point'
const SELECTED_FILL_LAYER_ID = 'fgb-selected-fill'
const SELECTED_LINE_LAYER_ID = 'fgb-selected-line'
const SELECTED_POINT_LAYER_ID = 'fgb-selected-point'
const TILED_FILL_LAYER_ID = 'fgb-tiled-fill'
const TILED_LINE_LAYER_ID = 'fgb-tiled-line'
const TILED_POINT_LAYER_ID = 'fgb-tiled-point'

const emptyCollection: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const fgbRef = useRef<FlatGeobufInstance | null>(null)
  const sourceRef = useRef<DatasetSource>({ kind: 'url', url: SAMPLE_URL })
  const fileUrlRef = useRef<string | null>(null)
  const inferredIdPropertyRef = useRef('FIPS')

  const [url, setUrl] = useState(SAMPLE_URL)
  const [status, setStatus] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [featureLimit, setFeatureLimit] = useState(DEFAULT_FEATURE_LIMIT)
  const [queryBoundsText, setQueryBoundsText] = useState(COLORADO_BBOX_TEXT)
  const [isSidebarHidden, setIsSidebarHidden] = useState(false)
  const [basemap, setBasemap] = useState<Basemap>('standard')
  const [features, setFeatures] = useState<Feature[]>([])
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null)
  const [hasMapMoved, setHasMapMoved] = useState(false)
  const [activeFeatureTab, setActiveFeatureTab] = useState<'features' | 'fields'>('features')
  const [copyState, setCopyState] = useState('Copy GeoJSON')
  const [metadataRows, setMetadataRows] = useState<MetadataRow[]>([])
  const [isMetadataOpen, setIsMetadataOpen] = useState(false)

  const selectedProperties = useMemo(() => {
    if (!selectedFeature?.properties) return []
    return Object.entries(selectedFeature.properties).slice(0, 80)
  }, [selectedFeature])

  const orderedFeatures = useMemo(() => {
    if (!selectedFeature) return features
    const selectedIndex = features.findIndex((feature) => areSameFeature(feature, selectedFeature, inferredIdPropertyRef.current))
    if (selectedIndex === -1) return [selectedFeature, ...features]
    return [features[selectedIndex], ...features.slice(0, selectedIndex), ...features.slice(selectedIndex + 1)]
  }, [features, selectedFeature])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      center: [-96, 38],
      zoom: 3.2,
      minZoom: 1.2,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          satellite: {
            type: 'raster',
            tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: 'Tiles &copy; Esri | Colton Loftus',
          },
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors | Colton Loftus',
          },
        },
        layers: [
          {
            id: 'satellite',
            type: 'raster',
            source: 'satellite',
            layout: {
              visibility: 'none',
            },
            paint: {
              'raster-opacity': 0.78,
              'raster-saturation': -0.18,
              'raster-contrast': -0.08,
              'raster-brightness-max': 0.88,
            },
          },
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
            paint: {
              'raster-opacity': 0.78,
              'raster-saturation': -0.72,
              'raster-contrast': -0.08,
              'raster-brightness-min': 0.08,
              'raster-brightness-max': 0.94,
            },
          },
        ],
      },
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    mapRef.current = map

    map.on('load', () => {
      addPreviewSourceAndLayers(map)
      void loadDataset(sourceRef.current, 'Initial preview')
    })

    map.on('mousemove', (event) => {
      const hits = map.queryRenderedFeatures(event.point, {
        layers: existingInteractiveLayers(map),
      })
      map.getCanvas().style.cursor = hits.length > 0 ? 'pointer' : 'crosshair'
    })

    map.on('click', (event) => {
      void handleMapClick(event)
    })

    map.on('moveend', (event) => {
      if ((event as { originalEvent?: Event }).originalEvent) setHasMapMoved(true)
    })

    return () => {
      destroyFlatGeobuf()
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current)
      map.remove()
      mapRef.current = null
    }
    // MapLibre owns this lifecycle after initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadDataset(nextSource: DatasetSource, mode: string) {
    const map = mapRef.current
    if (!map) return

    setIsBusy(true)
    setStatus(mode === 'Initial preview' ? `Reading up to ${featureLimit.toLocaleString()} features...` : 'Loading dataset...')
    selectFeature(null)

    try {
      sourceRef.current = nextSource
      const defaultBbox = getInitialBbox(nextSource)
      const queryBbox = defaultBbox ?? WORLD_BBOX
      setQueryBoundsText(formatBbox(queryBbox))
      const nextFeatures = await collectFeatures(nextSource, queryBbox, featureLimit, (metadata) => setMetadataRows(formatMetadataRows(metadata)))
      const nextIdProperty = inferIdProperty(nextFeatures) ?? inferredIdPropertyRef.current
      inferredIdPropertyRef.current = nextIdProperty
      const collection: FeatureCollection = { type: 'FeatureCollection', features: nextFeatures }
      setPreviewData(collection)
      setupTiledFlatGeobuf(nextSource, nextIdProperty)
      setFeatures(nextFeatures)

      const bounds = getFeatureBounds(nextFeatures)
      if (bounds) fitBounds(bounds)

      setStatus(nextFeatures.length === featureLimit ? 'Feature cap reached. Reduce the bounds or increase the display cap.' : '')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to read this FlatGeobuf dataset.')
      setPreviewData(emptyCollection)
      setFeatures([])
    } finally {
      setIsBusy(false)
    }
  }

  function setupTiledFlatGeobuf(nextSource: DatasetSource, idProperty: string) {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    removeTiledLayers(map)
    destroyFlatGeobuf()

    const dataUrl = nextSource.kind === 'url' ? nextSource.url : nextSource.objectUrl
    fgbRef.current = new FlatGeobuf(
      SOURCE_ID,
      map,
      {
        url: dataUrl,
        minZoom: 0,
        idProperty,
      },
      {
        promoteId: idProperty,
      },
    ) as FlatGeobufInstance

    addTiledLayers(map)
  }

  function destroyFlatGeobuf() {
    const map = mapRef.current
    if (!map || !fgbRef.current) return
    removeTiledLayers(map)
    if (map.getSource(SOURCE_ID)) {
      fgbRef.current.destroySource()
    } else {
      fgbRef.current.disableRequests()
    }
    fgbRef.current = null
  }

  function setPreviewData(collection: FeatureCollection) {
    const source = mapRef.current?.getSource(PREVIEW_SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(collection as Parameters<GeoJSONSource['setData']>[0])
  }

  function setSelectedData(feature: Feature | null) {
    const source = mapRef.current?.getSource(SELECTED_SOURCE_ID) as GeoJSONSource | undefined
    source?.setData({
      type: 'FeatureCollection',
      features: feature ? [feature] : [],
    } as Parameters<GeoJSONSource['setData']>[0])
  }

  function selectFeature(feature: Feature | null) {
    setSelectedFeature(feature)
    setSelectedData(feature)
    setCopyState('Copy GeoJSON')
    if (!feature) setActiveFeatureTab('features')
  }

  function selectResolvedFeature(feature: Feature) {
    const currentFeature =
      features.find((candidate) => areSameFeature(candidate, feature, inferredIdPropertyRef.current)) ?? feature
    selectFeature(currentFeature)
  }

  function fitBounds(bbox: BBox) {
    const map = mapRef.current
    if (!map) return
    map.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      { padding: 72, maxZoom: 11, duration: 700 },
    )
  }

  async function handleMapClick(event: MapMouseEvent) {
    const map = mapRef.current
    if (!map) return

    const hits = map.queryRenderedFeatures(event.point, {
      layers: existingInteractiveLayers(map),
    })

    if (hits[0]) {
      selectResolvedFeature(normalizeMapFeature(hits[0] as unknown as Feature))
      setStatus('')
      return
    }

    await runBoundsQuery(bboxFromClick(map, event))
  }

  async function runBoundsQuery(bbox: BBox) {
    setQueryBoundsText(formatBbox(bbox))
    setIsBusy(true)
    setStatus('Fetching features inside the current bounding box...')

    try {
      const nextFeatures = await collectFeatures(sourceRef.current, bbox, featureLimit, (metadata) => setMetadataRows(formatMetadataRows(metadata)))
      setPreviewData({ type: 'FeatureCollection', features: nextFeatures })
      setFeatures(nextFeatures)
      selectFeature(null)
      setStatus(nextFeatures.length === featureLimit ? 'Feature cap reached. Reduce the bounds or increase the display cap.' : '')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The bounding box query failed.')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleUrlSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextUrl = url.trim()
    if (!nextUrl) {
      setStatus('Enter a FlatGeobuf URL first.')
      return
    }
    await loadDataset({ kind: 'url', url: nextUrl }, 'Initial preview')
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current)

    const objectUrl = URL.createObjectURL(file)
    fileUrlRef.current = objectUrl
    const bytes = new Uint8Array(await file.arrayBuffer())
    await loadDataset({ kind: 'file', name: file.name, bytes, objectUrl }, 'Initial preview')
  }

  function resetToInitialPreview() {
    setHasMapMoved(false)
    void loadDataset(sourceRef.current, 'Initial preview')
  }

  function handleBasemapChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextBasemap = event.target.value as Basemap
    setBasemap(nextBasemap)
    applyBasemap(mapRef.current, nextBasemap)
  }

  function handleFeatureLimitChange(event: ChangeEvent<HTMLInputElement>) {
    const nextLimit = Number(event.target.value)
    if (!Number.isFinite(nextLimit)) return
    setFeatureLimit(Math.max(1, Math.min(50000, Math.trunc(nextLimit))))
  }

  function runEditedBoundsQuery() {
    const bbox = parseBbox(queryBoundsText)
    if (!bbox) {
      setStatus('Bounds must be four comma-separated numbers: minX, minY, maxX, maxY.')
      return
    }
    void runBoundsQuery(bbox)
  }

  async function copySelectedFeature() {
    if (!selectedFeature) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedFeature, null, 2))
      setCopyState('Copied')
      window.setTimeout(() => setCopyState('Copy GeoJSON'), 1400)
    } catch {
      setCopyState('Copy failed')
      window.setTimeout(() => setCopyState('Copy GeoJSON'), 1800)
    }
  }

  return (
    <main className="app-shell">
      {isSidebarHidden ? (
        <button type="button" className="sidebar-toggle collapsed" onClick={() => setIsSidebarHidden(false)} aria-label="Show sidebar">
          <PanelLeftOpen size={18} />
        </button>
      ) : null}

      <section className={isSidebarHidden ? 'sidebar hidden' : 'sidebar'} aria-label="FlatGeobuf controls">
        <button type="button" className="sidebar-toggle" onClick={() => setIsSidebarHidden(true)} aria-label="Hide sidebar">
          <PanelLeftClose size={18} />
        </button>

        <div className="brand">
          <h1>Flatgeobuf Viewer</h1>
          <a href="https://github.com/C-Loftus" target="_blank" rel="noreferrer">
            Made by Colton Loftus
          </a>
        </div>

        <form className="control-panel" onSubmit={handleUrlSubmit}>
          <label htmlFor="fgb-url">Remote FlatGeobuf URL</label>
          <div className="input-row">
            <Cloud size={18} />
            <input
              id="fgb-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/data.fgb"
              spellCheck={false}
            />
          </div>
          <button type="submit" className="primary-action" disabled={isBusy}>
            {isBusy ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
            Load URL
          </button>
        </form>

        <label className="file-drop">
          <FileUp size={22} />
          <span>
            <strong>Upload a .fgb file</strong>
            <small>Processed locally in this browser.</small>
          </span>
          <input type="file" accept=".fgb,application/octet-stream" onChange={handleFileChange} />
        </label>

        <div className="query-controls" aria-label="Query settings">
          <label>
            <span>Bounds</span>
            <input value={queryBoundsText} onChange={(event) => setQueryBoundsText(event.target.value)} />
          </label>
          <div className="query-row">
            <label>
              <span>CRS</span>
              <strong>{DISPLAY_CRS}</strong>
            </label>
            <button type="button" onClick={runEditedBoundsQuery} disabled={isBusy}>
              Query
            </button>
          </div>
        </div>

        <label className="cap-control" htmlFor="feature-limit">
          <span>
            <MapPin size={16} />
            Feature display cap
          </span>
          <input id="feature-limit" type="number" min="1" max="50000" step="100" value={featureLimit} onChange={handleFeatureLimitChange} />
        </label>

        <section className={isMetadataOpen ? 'metadata-panel open' : 'metadata-panel'}>
          <button type="button" className="metadata-toggle" onClick={() => setIsMetadataOpen((isOpen) => !isOpen)}>
            <span>Metadata</span>
            <strong>{isMetadataOpen ? 'Hide' : 'Show'}</strong>
          </button>
          {isMetadataOpen ? (
            <div className="metadata-table">
              {metadataRows.length > 0 ? (
                metadataRows.map((row) => (
                  <div className="metadata-row" key={row.key}>
                    <span>{row.key}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))
              ) : (
                <p className="empty-state">No metadata loaded.</p>
              )}
            </div>
          ) : null}
        </section>

        {status ? (
          <div className="status-card">
            <div className="status-icon">{isBusy ? <Loader2 className="spin" size={18} /> : <Search size={18} />}</div>
            <p>{status}</p>
          </div>
        ) : null}

        <div className="feature-panel" aria-label="Feature details">
          <div className="panel-heading">
            <TableProperties size={18} />
            <h2>Feature</h2>
          </div>

          {selectedFeature ? (
            <div className="selected-actions">
              <div className="geometry-chip">{selectedFeature.geometry?.type ?? 'Unknown geometry'}</div>
              <button type="button" className="copy-button" onClick={copySelectedFeature}>
                <Copy size={15} />
                {copyState}
              </button>
            </div>
          ) : null}

          <div className="feature-tabs" role="tablist" aria-label="Feature table tabs">
            <button
              type="button"
              className={activeFeatureTab === 'features' ? 'active' : ''}
              onClick={() => setActiveFeatureTab('features')}
            >
              Features
            </button>
            <button
              type="button"
              className={activeFeatureTab === 'fields' ? 'active' : ''}
              onClick={() => setActiveFeatureTab('fields')}
              disabled={!selectedFeature}
            >
              Fields
            </button>
          </div>

          {activeFeatureTab === 'features' ? (
            <div className="feature-list">
              <div className="feature-list-heading">
                <h3>Results</h3>
                <span>{features.length.toLocaleString()}</span>
              </div>
              {orderedFeatures.slice(0, 80).map((feature, index) => (
                <button
                  type="button"
                  key={featureKey(feature, index)}
                  className={selectedFeature && areSameFeature(feature, selectedFeature, inferredIdPropertyRef.current) ? 'active' : ''}
                  onClick={() => {
                    selectFeature(feature)
                  }}
                >
                  <span>{featureLabel(feature, index)}</span>
                  <small>{feature.geometry?.type ?? 'Geometry'}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="property-list">
              {selectedProperties.length > 0 ? (
                selectedProperties.map(([key, value]) => (
                  <div className="property-row" key={key}>
                    <span>{key}</span>
                    <strong>{formatValue(value)}</strong>
                  </div>
                ))
              ) : (
                <p className="empty-state">No fields.</p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="map-stage" aria-label="Map viewer">
        <div className="map-controls" aria-label="Map controls">
          {hasMapMoved ? (
            <button type="button" className="map-icon-button" onClick={resetToInitialPreview} disabled={isBusy} aria-label="Reset preview" title="Reset preview">
              <RefreshCcw size={17} />
            </button>
          ) : null}
          <label className="basemap-control">
            <Layers size={16} />
            <select value={basemap} onChange={handleBasemapChange} aria-label="Basemap">
              <option value="standard">Standard</option>
              <option value="satellite">Satellite</option>
            </select>
          </label>
        </div>
        <div ref={mapContainerRef} className="map" />
      </section>
    </main>
  )
}

async function collectFeatures(
  source: DatasetSource,
  bbox?: BBox,
  limit = DEFAULT_FEATURE_LIMIT,
  onMetadata?: (metadata: HeaderMeta) => void,
): Promise<Feature[]> {
  const queryBbox = bbox ?? WORLD_BBOX
  const rect = { minX: queryBbox[0], minY: queryBbox[1], maxX: queryBbox[2], maxY: queryBbox[3] }

  if (source.kind === 'file') {
    const collection = geojson.deserialize(source.bytes, rect, onMetadata) as FeatureCollection
    return collection.features.slice(0, limit)
  }

  const features: Feature[] = []
  for await (const feature of geojson.deserialize(source.url, rect, onMetadata) as AsyncGenerator<Feature>) {
    features.push(feature)
    if (features.length >= limit) break
  }
  return features
}

function formatMetadataRows(metadata: HeaderMeta): MetadataRow[] {
  const rows: MetadataRow[] = [
    { key: 'Features', value: metadata.featuresCount.toLocaleString() },
    { key: 'Geometry type', value: String(metadata.geometryType) },
    { key: 'Index node size', value: metadata.indexNodeSize.toLocaleString() },
  ]

  if (metadata.envelope) rows.push({ key: 'Envelope', value: Array.from(metadata.envelope).map((value) => Number(value.toFixed(6))).join(', ') })
  if (metadata.crs) rows.push({ key: 'CRS', value: formatCrs(metadata.crs) })
  if (metadata.title) rows.push({ key: 'Title', value: metadata.title })
  if (metadata.description) rows.push({ key: 'Description', value: metadata.description })
  if (metadata.metadata) rows.push({ key: 'Metadata', value: metadata.metadata })
  if (metadata.columns) rows.push({ key: 'Columns', value: metadata.columns.map((column) => `${column.name} (${column.type})`).join(', ') })

  return rows
}

function formatCrs(crs: NonNullable<HeaderMeta['crs']>) {
  const authority = crs.org && crs.code ? `${crs.org}:${crs.code}` : crs.code_string
  return [authority, crs.name].filter(Boolean).join(' · ') || 'Unknown'
}

function inferIdProperty(features: Feature[]) {
  const propertyNames = Object.keys(features[0]?.properties ?? {})
  if (propertyNames.length === 0) return null

  const preferredNames = ['id', 'ID', 'fid', 'FID', 'objectid', 'OBJECTID', 'geoid', 'GEOID', 'fips', 'FIPS']
  for (const name of preferredNames) {
    if (isUsefulIdProperty(features, name)) return name
  }

  return propertyNames.find((name) => isUsefulIdProperty(features, name)) ?? propertyNames[0]
}

function isUsefulIdProperty(features: Feature[], propertyName: string) {
  const values = new Set<unknown>()
  for (const feature of features.slice(0, 200)) {
    const value = feature.properties?.[propertyName]
    if (value === undefined || value === null || values.has(value)) return false
    values.add(value)
  }
  return values.size > 0
}

function formatBbox(bbox: BBox) {
  return bbox.map((value) => Number(value.toFixed(6))).join(', ')
}

function parseBbox(value: string): BBox | null {
  const numbers = value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part))

  if (numbers.length !== 4) return null
  const [minX, minY, maxX, maxY] = numbers
  if (minX >= maxX || minY >= maxY) return null
  return [minX, minY, maxX, maxY]
}

function getInitialBbox(source: DatasetSource) {
  return source.kind === 'url' && source.url === SAMPLE_URL ? COLORADO_BBOX : undefined
}

function applyBasemap(map: MapLibreMap | null, basemap: Basemap) {
  if (!map || !map.getLayer('osm') || !map.getLayer('satellite')) return
  map.setLayoutProperty('osm', 'visibility', basemap === 'standard' ? 'visible' : 'none')
  map.setLayoutProperty('satellite', 'visibility', basemap === 'satellite' ? 'visible' : 'none')
}

function addPreviewSourceAndLayers(map: MapLibreMap) {
  if (!map.getSource(PREVIEW_SOURCE_ID)) {
    map.addSource(PREVIEW_SOURCE_ID, {
      type: 'geojson',
      data: emptyCollection as Parameters<GeoJSONSource['setData']>[0],
    })
  }

  if (!map.getSource(SELECTED_SOURCE_ID)) {
    map.addSource(SELECTED_SOURCE_ID, {
      type: 'geojson',
      data: emptyCollection as Parameters<GeoJSONSource['setData']>[0],
    })
  }

  if (!map.getLayer(FILL_LAYER_ID)) {
    map.addLayer({
      id: FILL_LAYER_ID,
      type: 'fill',
      source: PREVIEW_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': '#0a84ff',
        'fill-opacity': 0.28,
      },
    })
  }

  if (!map.getLayer(LINE_LAYER_ID)) {
    map.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: PREVIEW_SOURCE_ID,
      paint: {
        'line-color': '#0066cc',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 10, 2.4],
        'line-opacity': 0.86,
      },
    })
  }

  if (!map.getLayer(POINT_LAYER_ID)) {
    map.addLayer({
      id: POINT_LAYER_ID,
      type: 'circle',
      source: PREVIEW_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': '#ff375f',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 12, 7],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    })
  }

  if (!map.getLayer(SELECTED_FILL_LAYER_ID)) {
    map.addLayer({
      id: SELECTED_FILL_LAYER_ID,
      type: 'fill',
      source: SELECTED_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': '#ff3b30',
        'fill-opacity': 0.38,
      },
    })
  }

  if (!map.getLayer(SELECTED_LINE_LAYER_ID)) {
    map.addLayer({
      id: SELECTED_LINE_LAYER_ID,
      type: 'line',
      source: SELECTED_SOURCE_ID,
      paint: {
        'line-color': '#d70015',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.2, 10, 4],
        'line-opacity': 0.95,
      },
    })
  }

  if (!map.getLayer(SELECTED_POINT_LAYER_ID)) {
    map.addLayer({
      id: SELECTED_POINT_LAYER_ID,
      type: 'circle',
      source: SELECTED_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': '#ff3b30',
        'circle-opacity': 0.72,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 12, 10],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
  }
}

function addTiledLayers(map: MapLibreMap) {
  if (!map.getLayer(TILED_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: TILED_FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#30d158',
          'fill-opacity': 0.18,
        },
      },
      FILL_LAYER_ID,
    )
  }

  if (!map.getLayer(TILED_LINE_LAYER_ID)) {
    map.addLayer(
      {
        id: TILED_LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': '#1d9f45',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 12, 2],
          'line-opacity': 0.58,
        },
      },
      LINE_LAYER_ID,
    )
  }

  if (!map.getLayer(TILED_POINT_LAYER_ID)) {
    map.addLayer(
      {
        id: TILED_POINT_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#30d158',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2, 12, 5],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      },
      POINT_LAYER_ID,
    )
  }
}

function removeTiledLayers(map: MapLibreMap) {
  for (const layerId of [TILED_POINT_LAYER_ID, TILED_LINE_LAYER_ID, TILED_FILL_LAYER_ID]) {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
  }
}

function existingInteractiveLayers(map: MapLibreMap) {
  return [
    SELECTED_POINT_LAYER_ID,
    SELECTED_LINE_LAYER_ID,
    SELECTED_FILL_LAYER_ID,
    POINT_LAYER_ID,
    LINE_LAYER_ID,
    FILL_LAYER_ID,
    TILED_POINT_LAYER_ID,
    TILED_LINE_LAYER_ID,
    TILED_FILL_LAYER_ID,
  ].filter((id) => Boolean(map.getLayer(id)))
}

function bboxFromClick(map: MapLibreMap, event: MapMouseEvent): BBox {
  const bounds = map.getBounds()
  const canvas = map.getCanvas()
  const lngSpan = Math.abs(bounds.getEast() - bounds.getWest())
  const latSpan = Math.abs(bounds.getNorth() - bounds.getSouth())
  const halfLng = Math.max((lngSpan / canvas.clientWidth) * QUERY_PIXELS * 0.5, 0.0005)
  const halfLat = Math.max((latSpan / canvas.clientHeight) * QUERY_PIXELS * 0.5, 0.0005)
  return [
    event.lngLat.lng - halfLng,
    event.lngLat.lat - halfLat,
    event.lngLat.lng + halfLng,
    event.lngLat.lat + halfLat,
  ]
}

function normalizeMapFeature(feature: Feature): Feature {
  return {
    type: 'Feature',
    id: feature.id,
    geometry: feature.geometry,
    properties: feature.properties ?? {},
  }
}

function getFeatureBounds(features: Feature[]): BBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const feature of features) {
    walkCoordinates(feature.geometry?.coordinates, (x, y) => {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    })
  }

  if (!Number.isFinite(minX)) return null
  return [minX, minY, maxX, maxY]
}

function walkCoordinates(value: unknown, visit: (x: number, y: number) => void) {
  if (!Array.isArray(value)) return
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    visit(value[0], value[1])
    return
  }
  for (const child of value) walkCoordinates(child, visit)
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function featureLabel(feature: Feature, index: number) {
  const props = feature.properties ?? {}
  const candidate = props.name ?? props.NAME ?? props.Name ?? props.id ?? props.ID ?? feature.id
  return candidate ? String(candidate) : `Feature ${index + 1}`
}

function featureKey(feature: Feature, index: number) {
  return `${feature.id ?? featureLabel(feature, index)}-${index}`
}

function areSameFeature(feature: Feature, otherFeature: Feature, idProperty: string) {
  if (feature === otherFeature) return true
  if (feature.id !== undefined && otherFeature.id !== undefined && feature.id === otherFeature.id) return true

  const featureId = feature.properties?.[idProperty]
  const otherFeatureId = otherFeature.properties?.[idProperty]
  if (featureId !== undefined && otherFeatureId !== undefined && featureId === otherFeatureId) return true

  const featureProps = feature.properties ?? {}
  const otherProps = otherFeature.properties ?? {}
  const fallbackKeys = ['id', 'ID', 'fid', 'FID', 'objectid', 'OBJECTID', 'geoid', 'GEOID', 'fips', 'FIPS']
  return fallbackKeys.some((key) => featureProps[key] !== undefined && featureProps[key] === otherProps[key])
}

export default App
