import L from 'leaflet'
import './app.scss'
import 'leaflet-measure-ex/dist/leaflet-measure'
import 'leaflet-measure-ex/dist/leaflet-measure.css'
import QuadratPopup from './QuadratPopup'
import Utils from 'webodm/classes/Utils'
import ReactDOM from 'ReactDOM'
import React from 'React'
import $ from 'jquery'
import { _, get_format } from 'webodm/classes/gettext'
import { unitSystem } from 'webodm/classes/Units'

export default class App {
  constructor(map, injectedTask) {
    this.map = map
    this.injectedTask = injectedTask || null
    this.apiBase = window.QUADRAT_API_BASE || 'http://localhost:7700'
    window.QUADRAT_API_BASE = this.apiBase
    this.hideGlobalTooltip = this.hideGlobalTooltip.bind(this)

    const measure = L.control.measure({
      _className: 'leaflet-control-measure quadrat-measure',
      labels: {
        measureDistancesAndAreas: _('绘制样方并分析'),
        areaMeasurement: _('样方分析'),
        measure: _('测量'),
        createNewMeasurement: _('创建新样方'),
        startCreating: _('在地图上添加点开始绘制样方'),
        finishMeasurement: _('完成样方绘制'),
        lastPoint: _('最后一个点'),
        area: _('面积'),
        perimeter: _('周长'),
        pointLocation: _('点位置'),
        linearMeasurement: _('线性测量'),
        pathDistance: _('路径距离'),
        centerOnArea: _('居中到此区域'),
        centerOnLine: _('居中到此线段'),
        centerOnLocation: _('居中到此位置'),
        cancel: _('取消'),
        delete: _('删除'),
        acres: _('英亩'),
        feet: _('英尺'),
        kilometers: _('千米'),
        hectares: _('公顷'),
        meters: _('米'),
        miles: _('英里'),
        sqfeet: _('平方英尺'),
        sqmeters: _('平方米'),
        sqmiles: _('平方英里'),
        decPoint: get_format('DECIMAL_SEPARATOR'),
        thousandsSep: get_format('THOUSAND_SEPARATOR')
      },
      primaryLengthUnit: 'meters',
      secondaryLengthUnit: 'feet',
      primaryAreaUnit: 'sqmeters',
      secondaryAreaUnit: 'acres',
      activeColor: '#9915a7',
      completedColor: '#9915a7',
      popupOptions: {
        className: 'quadrat-popup',
        autoPan: true,
        autoPanPadding: L.point(50, 50)
      }
    }).addTo(map)

    if (measure && measure._container) {
      measure._container.classList.add('quadrat-control')
    }

    this.measure = measure

    measure._getMeasurementDisplayStrings = measurement => {
      const us = unitSystem()
      return {
        lengthDisplay: us.length(measurement.length).toString(),
        areaDisplay: us.area(measurement.area).toString()
      }
    }

    const $btnExportAll = $(`<br/><a href='#' class='js-start start'>${_('导出所有样方到GeoJSON')}</a>`)
    $btnExportAll.appendTo($(measure.$startPrompt).children('ul.tasks'))
    $btnExportAll.on('click', () => {
      const features = []
      map.eachLayer(layer => {
        const mp = layer._measurePopup
        if (mp) {
          features.push(mp.getGeoJSON())
        }
      })
      if (features.length === 0){
        alert(_('当前无样方数据，请圈画样方后再导出'))
        return
      }
      const geoJSON = {
        type: 'FeatureCollection',
        features: features
      }
      Utils.saveAs(JSON.stringify(geoJSON, null, 4), 'quadrats.geojson')
    })

    const $btnExportExcel = $(`<br/><a href='#' class='js-start start'>${_('导出所有样方到Excel')}</a>`)
    $btnExportExcel.appendTo($(measure.$startPrompt).children('ul.tasks'))
    $btnExportExcel.on('click', async () => { await this.exportAllToExcel() })
    this.initEcho()
    this.renderQuadratList()
    this.generateAllQuadratStats()

    this.map.on('click', this.hideGlobalTooltip)
    this.map.on('movestart', this.hideGlobalTooltip)
    this.map.on('dragstart', this.hideGlobalTooltip)
    this.map.on('zoomstart', this.hideGlobalTooltip)

    map.on('measurepopupshown', ({ popupContainer, model, resultFeature }) => {
      const $container = $('<div class="plugin-quadrat-container"/>')
      const $popup = $(popupContainer)
      $popup.addClass('quadrat-active')
      $popup.children().not('ul.tasks').remove()
      $popup.children('ul.tasks').before($container)
      ReactDOM.render(<QuadratPopup
        model={model}
        resultFeature={resultFeature}
        map={map} />, $container.get(0))
      this.renderQuadratList()
      this.generateAllQuadratStats()
    })
  }

  renderQuadratList() {
    const items = []
    this.map.eachLayer(layer => {
      const mp = layer._measurePopup
      if (mp && mp.state && mp.state.featureType === 'Polygon') {
        const gj = mp.getGeoJSON()
        const coords = (gj.geometry && gj.geometry.coordinates && gj.geometry.coordinates[0]) ? gj.geometry.coordinates[0] : []
        if (coords.length) {
          const closed = coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]
          const verts = closed ? coords.slice(0, -1) : coords
          const bounds = L.latLngBounds(verts.map(v => L.latLng(v[1], v[0])))
          const id = (mp && mp.props && mp.props.resultFeature && mp.props.resultFeature._quadratProps && mp.props.resultFeature._quadratProps.raw) ? mp.props.resultFeature._quadratProps.raw.id : null
          items.push({ layer, bounds, id })
        }
      }
    })

    const $startPrompt = $(this.measure.$startPrompt)
    let $cont = $startPrompt.children('.quadrat-created')
    if ($cont.length === 0) {
      $cont = $('<div class="quadrat-created"/>')
      $startPrompt.children('ul.tasks').before($cont)
    }
    $cont.empty()
    if (items.length > 0) {
      const $title = $(`<p class='created-title'>${_('已创建样方')}</p>`) 
      $cont.append($title)
      const $ul = $('<ul class="quadrat-list"/>')
      items.forEach((it, idx) => {
        const $li = $('<li class="quadrat-item"/>')
        const $label = $(`<span >${_('样方')} ${idx + 1}</span>`) 
        const $actions = $("<span class='actions'></span>")
        const $loc = $("<a href='#' class='locate' title='定位'><i class='fa fa-crosshairs'></i></a>")
        const $del = $("<a href='#' class='delete' title='删除'><i class='fa fa-trash'></i></a>")
        $loc.on('click', (e) => { e.preventDefault(); this.map.fitBounds(it.bounds) })
        $del.on('click', async (e) => { e.preventDefault(); await this.deleteQuadrat(it) })
        $actions.append($loc)
        $actions.append($del)
        $li.append($label)
        $li.append($actions)
        $ul.append($li)
      })
      $cont.append($ul)
    }
  }

  getTaskFromMap() {
    console.log('getTaskFromMap', this.injectedTask)
    if (this.injectedTask) return this.injectedTask
    let found = null
    this.map.eachLayer(layer => {
      const meta = layer && layer[Symbol.for('meta')]
      if (meta && meta.task && !found) found = meta.task
    })
    return found
  }

  setAllPopupsError(message){
    const msg = String(message)
    this.map.eachLayer(layer => {
      const mp = layer._measurePopup
      if (mp && typeof mp.setState === 'function') mp.setState({ error: msg })
    })
  }

  async getSamplingId(){
    if (this.samplingId) return this.samplingId
    const task = this.getTaskFromMap()
    if (!task) return null
    const project_id = task.project
    const task_id = task.id
    try{
      const r = await fetch(`${this.apiBase}/api/odm/samplings/retrieve_or_create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id, task_id }) })
      if (!r.ok) return null
      const j = await r.json()
      this.samplingId = j.id || j.sampling_id
      return this.samplingId
    }catch(e){ return null }
  }

  getQuadratsFromMap() {
    const items = []
    this.map.eachLayer(layer => {
      const mp = layer._measurePopup
      if (mp && mp.state && mp.state.featureType === 'Polygon') {
        const gj = mp.getGeoJSON()
        const coords = (gj.geometry && gj.geometry.coordinates && gj.geometry.coordinates[0]) ? gj.geometry.coordinates[0] : []
        if (coords.length) {
          const closed = coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]
          const verts = closed ? coords.slice(0, -1) : coords
          const vertices = verts.map(v => [v[0], v[1]])
          const cx = vertices.reduce((s,v)=>s+v[0],0) / vertices.length
          const cy = vertices.reduce((s,v)=>s+v[1],0) / vertices.length
          const idx = String(layer._leaflet_id)
          items.push({ layer, payload: { idx, coords: vertices, center: [cx, cy] } })
        }
      }
    })
    return items
  }

  generateAllQuadratStats() {
    const task = this.getTaskFromMap()
    if (!task) return
    const all = this.getQuadratsFromMap()
    if (all.length === 0) return
    const payload = all.map(it => it.payload)
    this.getSamplingId().then(samplingId => {
      if (!samplingId) return
      this.samplingId = samplingId
      $.ajax({ type: 'POST', url: `${this.apiBase}/api/odm/samplings/${samplingId}/statistics`, data: JSON.stringify(payload), contentType: 'application/json' })
        .done((_r2, _t2, jq2) => {
           if (!(jq2.status === 200 || jq2.status === 202)) { this.setAllPopupsError(_('统计任务启动失败: ') + jq2.status); return }
           if (this.pollTimer) clearInterval(this.pollTimer)
           this.pollTimer = setInterval(() => {
            $.ajax({ type: 'GET', url: `${this.apiBase}/api/odm/samplings/${samplingId}` })
               .done((r3, _t3, jq3) => {
                 if (jq3.status !== 200) { this.setAllPopupsError(_('查询失败: ') + jq3.status); return }
                 const progress = r3.progress || 0
                 if (progress === 100 && r3.state === 'COMPLETED') {
                    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
                 const quadrats = Array.isArray(r3.quadrats) ? r3.quadrats : []
                  const byName = {}
                  for (let i=0;i<quadrats.length;i++){
                    const q = quadrats[i]
                    if (q && q.idx !== undefined && q.idx !== null) byName[String(q.idx)] = q
                  }
                  
                  this.map.eachLayer(layer => {
                    const mp = layer._measurePopup
                    if (mp && mp.state && mp.state.featureType === 'Polygon') {
                      const gj = mp.getGeoJSON()
                      const coords = (gj.geometry && gj.geometry.coordinates && gj.geometry.coordinates[0]) ? gj.geometry.coordinates[0] : []
                      const closed = coords.length && coords[0][0]===coords[coords.length-1][0] && coords[0][1]===coords[coords.length-1][1]
                      const verts = closed ? coords.slice(0, -1) : coords
                      const idx = String(layer._leaflet_id)
                      // TODO 写死第一个测试
                      const matched = byName[idx]
                      const vertices = matched && matched.coords ? matched.coords.map(v => ({ lon: v[0], lat: v[1] })) : verts.map(v => ({ lon: v[0], lat: v[1] }))
                      let cx = null, cy = null
                      if (matched && matched.center && matched.center.length===2){
                        cx = matched.center[0]
                        cy = matched.center[1]
                      } else if (vertices.length){
                        cx = vertices.reduce((s,v)=>s+v.lon,0)/vertices.length
                        cy = vertices.reduce((s,v)=>s+v.lat,0)/vertices.length
                      }
                      const reflectance = {}
                      const indices = {}
                      const statsArr = matched && matched.statistics ? matched.statistics : []
                      for (let k=0;k<statsArr.length;k++){
                        const s = statsArr[k]
                        const v = { min: s.dn_min.toFixed(2), max: s.dn_max.toFixed(2), mean: s.dn_mean.toFixed(2), std: s.dn_std.toFixed(2) }
                        const an = (s.algo_name || '').toLowerCase()
                        if (an==='r') reflectance.Red = v
                        else if (an==='g') reflectance.Green = v
                        else if (an==='b') reflectance.Blue = v
                        else if (an==='re') reflectance.RE = v
                        else if (an==='n') reflectance.NIR = v
                        else if (an==='ndvi') indices.NDVI = v
                        else if (an==='gndvi') indices.GNDVI = v
                        else if (an==='ndre') indices.NDRE = v
                      }
                      const stats = { vertices, centroid: { lon: cx, lat: cy }, reflectance, indices, raw: matched }
                      if (mp && mp.props && mp.props.resultFeature) mp.props.resultFeature._quadratProps = stats
                      if (typeof mp.setState === 'function') mp.setState({ error: '' })
                    }
                  })
                }
                })
               .fail(err => { this.setAllPopupsError(err) })
           }, 2000)
          })
        .fail(err => { this.setAllPopupsError(err && err.status ? (_('统计任务启动失败: ') + err.status) : _('统计任务启动失败')) })
    })
  }

  async exportAllToExcel(){
    const sid = await this.getSamplingId()
    // 判断当前是否有样方数据
    let hasFeatures = false
    this.map.eachLayer(layer => { if (layer._measurePopup) hasFeatures = true })
    if (!hasFeatures){ alert(_('当前无样方数据，请圈画样方后再导出')); return }
    if (!sid) return
    const r2 = await fetch(`${this.apiBase}/api/odm/samplings/${sid}/export_to_excel`)
    if (!r2.ok) return
    const data = await r2.json()
    console.log(`${this.apiBase}/${data}`)
    window.top.dispatchEvent(
        new CustomEvent("openFile", {
            detail: { type: "saveFile", files: [`${this.apiBase}/${data}`] },
        })
    );
  }

  async initEcho(){
    const sid = await this.getSamplingId()
    if (!sid) return
    try{
      const r = await fetch(`${this.apiBase}/api/odm/samplings/${sid}`)
      if (!r.ok) return
      const data = await r.json()
      const quadrats = Array.isArray(data.quadrats) ? data.quadrats : []
      quadrats.forEach(q => this.addQuadratLayer(q))
      this.renderQuadratList()
    }catch(e){ /* ignore */ }
  }

  addQuadratLayer(q){
    const latlngs = (q.coords || []).map(c => L.latLng(c[1], c[0]))
    if (latlngs.length === 0) return
    const poly = L.polygon(latlngs, { color: '#9915a7' }).addTo(this.map)
    poly.options.bounds = L.latLngBounds(latlngs)
    const reflectance = {}
    const indices = {}
    const statsArr = Array.isArray(q.statistics) ? q.statistics : []
    for (let k=0;k<statsArr.length;k++){
      const s = statsArr[k]
      const v = { min: s.dn_min.toFixed(2), max: s.dn_max.toFixed(2), mean: s.dn_mean.toFixed(2), std: s.dn_std.toFixed(2) }
      const an = (s.algo_name || '').toLowerCase()
      if (an==='r') reflectance.Red = v
      else if (an==='g') reflectance.Green = v
      else if (an==='b') reflectance.Blue = v
      else if (an==='re') reflectance.RE = v
      else if (an==='n') reflectance.NIR = v
      else if (an==='ndvi') indices.NDVI = v
      else if (an==='gndvi') indices.GNDVI = v
      else if (an==='ndre') indices.NDRE = v
    }
    const vertices = (q.coords || []).map(v => ({ lon: v[0], lat: v[1] }))
    const centroid = q.center && q.center.length===2 ? { lon: q.center[0], lat: q.center[1] } : null
    const R = 6378137
    const deg = Math.PI/180
    const coords = (q.coords || [])
    const latAvg = coords.length ? coords.reduce((s,c)=>s+c[1],0)/coords.length : 0
    const toXY = c => [c[0]*deg*R*Math.cos(latAvg*deg), c[1]*deg*R]
    let area = 0
    if (coords.length>=3){
      const ring = coords.slice()
      if (!(ring[0][0]===ring[ring.length-1][0] && ring[0][1]===ring[ring.length-1][1])) ring.push(ring[0])
      for (let i=0;i<ring.length-1;i++){
        const [x1,y1] = toXY(ring[i])
        const [x2,y2] = toXY(ring[i+1])
        area += (x1*y2 - x2*y1)
      }
      area = Math.abs(area)/2
    }
    const haversine = (a,b) => {
      const lat1 = a.lat*deg, lon1 = a.lng*deg
      const lat2 = b.lat*deg, lon2 = b.lng*deg
      const dlat = lat2-lat1, dlon = lon2-lon1
      const h = Math.sin(dlat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2
      return 2*R*Math.asin(Math.sqrt(h))
    }
    let length = 0
    if (latlngs.length>=2){
      for (let i=0;i<latlngs.length;i++){
        const a = latlngs[i]
        const b = latlngs[(i+1)%latlngs.length]
        length += haversine(a,b)
      }
    }
    const us = unitSystem()
    const model = { lengthDisplay: us.length(length).toString(), areaDisplay: us.area(area).toString(), length, area }
    const resultFeature = {
      toGeoJSON: (precision) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ (q.coords || []).concat(q.coords && q.coords[0] ? [q.coords[0]] : []) ] }, properties: { Length: us.length(length).value, Area: us.area(area).value, Vertices: vertices, Centroid: centroid || {}, Reflectance: reflectance, Indices: indices, UnitSystem: 'metric' } })
    }
    resultFeature._quadratProps = { vertices, centroid: centroid || {}, reflectance, indices, raw: q }
    const mp = { state: { featureType: 'Polygon' }, getGeoJSON: () => resultFeature.toGeoJSON(14), props: { resultFeature } }
    poly._measurePopup = mp
    poly.on('click', (e) => {
      const container = document.createElement('div')
      const popup = L.popup({ className: 'quadrat-popup' }).setLatLng(e.latlng).setContent(container)
      popup.openOn(this.map)
      ReactDOM.render(<QuadratPopup model={model} resultFeature={resultFeature} map={this.map} />, container)
    })
  }

  async deleteQuadrat(it){
    const sid = await this.getSamplingId()
    if (!sid){ alert(_('无法获取样品号')); return }
    const qid = it.id
    if (!qid){ if (it.layer && this.map.hasLayer(it.layer)) { it.layer.remove(); this.renderQuadratList() } return }
    try{
      const r = await fetch(`${this.apiBase}/api/odm/samplings/${sid}/quadrat/${qid}`, { method: 'DELETE' })
      if (r.status === 204){
        if (it.layer && this.map.hasLayer(it.layer)) { it.layer.remove(); this.renderQuadratList() }
        this.map.closePopup()
        this.hideGlobalTooltip()
      }else{
        alert(_('删除失败: ') + r.status)
      }
    }catch(e){ alert(_('删除失败')) }
  }

  hideGlobalTooltip(){
    const el = document.querySelector('.quad-tooltip')
    if (el) el.style.display = 'none'
  }
}
