import React from 'react'
import PropTypes from 'prop-types'
import './QuadratPopup.scss'
import Utils from 'webodm/classes/Utils'
import { _, interpolate } from 'webodm/classes/gettext'
import { systems, unitSystem, getUnitSystem } from 'webodm/classes/Units'
import $ from 'jquery'
import L from 'leaflet'

export default class QuadratPopup extends React.Component {
  static defaultProps = { map: {}, model: {}, resultFeature: {} }
  static propTypes = { map: PropTypes.object.isRequired, model: PropTypes.object.isRequired, resultFeature: PropTypes.object.isRequired }

  constructor(props) {
    super(props)
    let featureType = 'Point'
    if (props.model.area !== 0) featureType = 'Polygon'
    else if (props.model.length > 0) featureType = 'LineString'
    this.state = { featureType, error: '' }
    this.exportMeasurement = this.exportMeasurement.bind(this)
    this.getProperties = this.getProperties.bind(this)
    this.getGeoJSON = this.getGeoJSON.bind(this)
    this.showTooltip = this.showTooltip.bind(this)
    this.hideTooltip = this.hideTooltip.bind(this)
  }

  componentDidMount() {
    this.props.resultFeature._measurePopup = this
  }

  componentWillUnmount() {
    this.props.resultFeature._measurePopup = null
    if (this.pollTimer) clearInterval(this.pollTimer)
  }

  getProperties() {
    const us = systems[this.lastUnitSystem]
    const base = { Length: us.length(this.props.model.length).value, Area: us.area(this.props.model.area).value }
    const qp = this.props.resultFeature._quadratProps || {}
    if (qp.vertices) base.Vertices = qp.vertices
    if (qp.centroid) base.Centroid = qp.centroid
    if (!base.Vertices || !base.Centroid){
      const gj = this.props.resultFeature.toGeoJSON(14)
      const coords = (gj.geometry && gj.geometry.coordinates && gj.geometry.coordinates[0]) ? gj.geometry.coordinates[0] : []
      const closed = coords.length && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]
      const verts = closed ? coords.slice(0, -1) : coords
      const vertices = verts.map(v => ({ lon: v[0], lat: v[1] }))
      base.Vertices = vertices
      if (vertices.length) {
        const cx = vertices.reduce((s, v) => s + v.lon, 0) / vertices.length
        const cy = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length
        base.Centroid = { lon: cx, lat: cy }
      } else {
        base.Centroid = { lon: null, lat: null }
      }
    }
    base.Reflectance = qp.reflectance || { Red: {}, Green: {}, Blue: {}, RE: {}, NIR: {} }
    base.Indices = qp.indices || { NDVI: {}, GNDVI: {}, NDRE: {} }
    base.UnitSystem = this.lastUnitSystem
    return base
  }

  getGeoJSON() {
    const geoJSON = this.props.resultFeature.toGeoJSON(14)
    geoJSON.properties = this.getProperties()
    return geoJSON
  }

  exportMeasurement() {
    const geoJSON = { type: 'FeatureCollection', features: [this.getGeoJSON()] }
    Utils.saveAs(JSON.stringify(geoJSON, null, 4), 'quadrat.geojson')
  }

  

  

  render() {
    const { error, featureType } = this.state
    const us = unitSystem()
    this.lastUnitSystem = getUnitSystem()
    const stats = this.props.resultFeature._quadratProps || null
    const vertices = stats && stats.vertices ? stats.vertices : []
    const centroid = stats && stats.centroid ? stats.centroid : {}
    const reflectance = stats && stats.reflectance ? stats.reflectance : {}
    const indices = stats && stats.indices ? stats.indices : {}
    const verticesText = vertices.map(v => `${v.lon},${v.lat}`).join(' | ')
    return (<div className="plugin-quadrat popup">
      {featureType == 'Polygon' && <p>{_('周长:')} {this.props.model.lengthDisplay}</p>}
      {featureType == 'Polygon' && <p>{_('面积:')} {this.props.model.areaDisplay}</p>}
      {featureType == 'Polygon' && !stats && !error && <p>{_('分析:')} <i>{_('计算中…')}</i> <i className="fa fa-cog fa-spin fa-fw" /></p>}
      {stats ? [
        <p className="vertices-line" onMouseEnter={(e) => this.showTooltip(e, verticesText)} onMouseLeave={this.hideTooltip}>{_('样方坐标:')} {verticesText}</p>,
        <p>{_('中心点坐标:')} {(centroid.lon !== undefined && centroid.lat !== undefined) ? `${centroid.lon},${centroid.lat}` : ''}</p>,
        <div className="table-block">
          <p>{_('反射率统计:')}</p>
          <table className="stats-table">
            <thead>
              <tr>
                <th>{_('波段')}</th>
                <th>min</th>
                <th>max</th>
                <th>mean</th>
                <th>std</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(reflectance).map(k => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{reflectance[k].min}</td>
                  <td>{reflectance[k].max}</td>
                  <td>{reflectance[k].mean}</td>
                  <td>{reflectance[k].std}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{_('光谱指数统计:')}</p>
          <table className="stats-table">
            <thead>
              <tr>
                <th>{_('指数')}</th>
                <th>min</th>
                <th>max</th>
                <th>mean</th>
                <th>std</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(indices).map(k => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{indices[k].min}</td>
                  <td>{indices[k].max}</td>
                  <td>{indices[k].mean}</td>
                  <td>{indices[k].std}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ] : ''}
      {error && <p>{_('分析:')} <span className={'error theme-background-failed ' + (String(error).length > 200 ? 'long' : '')}>{String(error)}</span></p>}
      <a href="#" onClick={this.exportMeasurement} className="export-measurements"><i className="fa fa-download"></i> {_('导出到GeoJSON')}</a>
    </div>)
  }

  showTooltip(e, text) {
    if (!text) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (!this.tooltipEl) {
      this.tooltipEl = document.createElement('div')
      this.tooltipEl.className = 'quad-tooltip'
      document.body.appendChild(this.tooltipEl)
    }
    this.tooltipEl.textContent = text
    this.tooltipEl.style.left = `${Math.round(rect.left)}px`
    this.tooltipEl.style.top = `${Math.round(rect.bottom + 6)}px`
    this.tooltipEl.style.display = 'block'
  }

  hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.style.display = 'none'
  }
}
