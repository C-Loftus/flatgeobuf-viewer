declare module '*.svg' {
  const src: string
  export default src
}

declare module 'mapbox-gl-flatgeobuf' {
  export default class FlatGeobuf {
    constructor(
      sourceId: string,
      map: unknown,
      flatGeobufOptions: {
        url: string
        minZoom?: number
        idProperty: string
      },
      geojsonSourceOptions?: Record<string, unknown>,
    )
    destroySource(): void
    disableRequests(): void
    enableRequests(): void
  }
}
