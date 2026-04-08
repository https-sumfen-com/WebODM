import L from "leaflet";
import "./app.scss";
import "leaflet-measure-ex/dist/leaflet-measure";
import "leaflet-measure-ex/dist/leaflet-measure.css";
import "leaflet-path-drag";
import "leaflet-editable";
import QuadratPopup from "./QuadratPopup";
import Utils from "webodm/classes/Utils";
import ReactDOM from "ReactDOM";
import React from "React";
import $ from "jquery";
import { _, get_format } from "webodm/classes/gettext";
import { unitSystem } from "webodm/classes/Units";
import config, { isDev } from "./config";

export default class App {
  constructor(map, injectedTask) {
    this.map = map;
    this.injectedTask = injectedTask || null;
    this.apiBase =
      config.API_BASE || window.QUADRAT_API_BASE || "http://localhost:7700";
    window.QUADRAT_API_BASE = this.apiBase;
    this.devMode = isDev;
    this.devConfig = config;
    this.hideGlobalTooltip = this.hideGlobalTooltip.bind(this);

    // 初始化 leaflet-editable (手动创建 editTools，因为 map 不是我们创建的)
    if (!this.map.editTools) {
      this.map.editTools = new L.Editable(this.map, { zIndex: 1000 });
    }

    const measure = L.control
      .measure({
        _className: "leaflet-control-measure quadrat-measure",
        labels: {
          measureDistancesAndAreas: _("绘制样方并分析"),
          areaMeasurement: _("样方分析"),
          measure: _("测量"),
          createNewMeasurement: _("创建新样方"),
          startCreating: _("在地图上添加点开始绘制样方"),
          finishMeasurement: _("完成样方绘制"),
          lastPoint: _("最后一个点"),
          area: _("面积"),
          perimeter: _("周长"),
          pointLocation: _("点位置"),
          linearMeasurement: _("线性测量"),
          pathDistance: _("路径距离"),
          centerOnArea: _("居中到此区域"),
          centerOnLine: _("居中到此线段"),
          centerOnLocation: _("居中到此位置"),
          cancel: _("取消"),
          delete: _("删除"),
          acres: _("英亩"),
          feet: _("英尺"),
          kilometers: _("千米"),
          hectares: _("公顷"),
          meters: _("米"),
          miles: _("英里"),
          sqfeet: _("平方英尺"),
          sqmeters: _("平方米"),
          sqmiles: _("平方英里"),
          decPoint: get_format("DECIMAL_SEPARATOR"),
          thousandsSep: get_format("THOUSAND_SEPARATOR"),
        },
        primaryLengthUnit: "meters",
        secondaryLengthUnit: "feet",
        primaryAreaUnit: "sqmeters",
        secondaryAreaUnit: "acres",
        activeColor: "#9915a7",
        completedColor: "#9915a7",
        popupOptions: {
          className: "quadrat-popup",
          autoPan: true,
          autoPanPadding: L.point(50, 50),
        },
      })
      .addTo(map);

    if (measure && measure._container) {
      measure._container.classList.add("quadrat-control");
    }

    this.measure = measure;

    measure._getMeasurementDisplayStrings = (measurement) => {
      const us = unitSystem();
      return {
        lengthDisplay: us.length(measurement.length).toString(),
        areaDisplay: us.area(measurement.area).toString(),
      };
    };

    // const $btnExportAll = $(`<br/><a href='#' class='js-start start'>${_('导出所有样方到GeoJSON')}</a>`)
    // $btnExportAll.appendTo($(measure.$startPrompt).children('ul.tasks'))
    // $btnExportAll.on('click', () => {
    //   const features = []
    //   map.eachLayer(layer => {
    //     const mp = layer._measurePopup
    //     if (mp) {
    //       features.push(mp.getGeoJSON())
    //     }
    //   })
    //   if (features.length === 0){
    //     alert(_('当前无样方数据，请圈画样方后再导出'))
    //     return
    //   }
    //   const geoJSON = {
    //     type: 'FeatureCollection',
    //     features: features
    //   }
    //   Utils.saveAs(JSON.stringify(geoJSON, null, 4), 'quadrats.geojson')
    // })

    const $btnExportExcel = $(
      `<br/><a href='#' class='js-start start'>${_("导出所有样方到Excel")}</a>`,
    );
    $btnExportExcel.appendTo($(measure.$startPrompt).children("ul.tasks"));
    $btnExportExcel.on("click", async () => {
      await this.exportAllToExcel();
    });
    this.initEcho();
    this.renderQuadratList();
    this.generateAllQuadratStats();

    this.map.on("click", this.hideGlobalTooltip);
    this.map.on("movestart", this.hideGlobalTooltip);
    this.map.on("dragstart", this.hideGlobalTooltip);
    this.map.on("zoomstart", this.hideGlobalTooltip);

    map.on("measurepopupshown", ({ popupContainer, model, resultFeature }) => {
      // 查找对应的 layer
      let foundLayer = null;
      this.map.eachLayer((layer) => {
        const mp = layer._measurePopup;
        if (mp && mp.props && mp.props.resultFeature === resultFeature) {
          foundLayer = layer;
        }
      });

      // 检查是否是新创建的样方（没有 raw 数据）
      const existingRaw =
        resultFeature._quadratProps && resultFeature._quadratProps.raw;
      const isNewQuadrat = !existingRaw || !existingRaw.id;

      if (isNewQuadrat) {
        // 新样方：先弹出名称输入对话框
        this.promptQuadratName((name) => {
          // 用户确认名称后，初始化 _quadratProps
          if (!resultFeature._quadratProps) resultFeature._quadratProps = {};
          if (!resultFeature._quadratProps.raw)
            resultFeature._quadratProps.raw = {};
          resultFeature._quadratProps.raw.sort_no = name;

          // 渲染弹窗
          this.renderQuadratPopup(
            popupContainer,
            model,
            resultFeature,
            foundLayer,
          );
          this.renderQuadratList();
          // 仅新样方才提交统计
          this.generateAllQuadratStats();
        });
      } else {
        // 已有样方：直接渲染，不重复提交统计
        this.renderQuadratPopup(
          popupContainer,
          model,
          resultFeature,
          foundLayer,
        );
        this.renderQuadratList();
        // 已有样方不重复提交
      }
    });
  }

  renderQuadratPopup(popupContainer, model, resultFeature, layer) {
    const $container = $('<div class="plugin-quadrat-container"/>');
    const $popup = $(popupContainer);
    $popup.addClass("quadrat-active");
    $popup.children().not("ul.tasks").remove();
    $popup.children("ul.tasks").before($container);
    ReactDOM.render(
      <QuadratPopup
        model={model}
        resultFeature={resultFeature}
        map={this.map}
        onEditGeometry={() => this.startGeometryEdit(layer, resultFeature)}
      />,
      $container.get(0),
    );
  }

  startGeometryEdit(layer, resultFeature) {
    if (!layer || !this.map.hasLayer(layer)) return;

    // 关闭弹窗
    this.map.closePopup();

    // 保存原始坐标用于取消时恢复
    const latlngs = layer.getLatLngs()[0];
    this._originalLatLngs = latlngs.map((ll) => ({ lat: ll.lat, lng: ll.lng }));
    this._editingLayer = layer;
    this._editingResultFeature = resultFeature;

    // 同时启用顶点编辑 + 拖拽
    layer.enableEdit();
    this._ensureDraggable(layer);
    layer.dragging.enable();

    // 添加编辑样式 + cursor class
    layer.setStyle({ color: "#FF9800", dashArray: "5, 5" });
    $(this.map.getContainer()).addClass("quadrat-editing");

    // 显示编辑控制按钮
    this.showEditControls();

    // 刷新列表
    this.renderQuadratList();
  }

  _ensureDraggable(layer) {
    if (!layer.dragging) {
      layer.options.draggable = true;
      if (L.Handler.PathDrag) {
        layer.dragging = new L.Handler.PathDrag(layer);
      }
    }
  }

  showEditControls() {
    this.hideEditControls();

    const $controls = $(`
      <div class="quadrat-edit-controls">
        <button class="btn btn-cancel">${_("取消")}</button>
        <button class="btn btn-confirm">${_("确认")}</button>
      </div>
    `);

    $controls.find(".btn-cancel").on("click", () => this.cancelGeometryEdit());
    $controls
      .find(".btn-confirm")
      .on("click", () => this.confirmGeometryEdit());

    $("body").append($controls);
    this._$editControls = $controls;
  }

  hideEditControls() {
    if (this._$editControls) {
      this._$editControls.remove();
      this._$editControls = null;
    }
  }

  cancelGeometryEdit() {
    if (!this._editingLayer) return;

    // 禁用所有编辑模式
    this._editingLayer.disableEdit();
    if (this._editingLayer.dragging) this._editingLayer.dragging.disable();

    // 恢复原始坐标
    if (this._originalLatLngs) {
      const latlngs = this._originalLatLngs.map((p) => L.latLng(p.lat, p.lng));
      this._editingLayer.setLatLngs(latlngs);
    }

    // 恢复原始样式
    this._editingLayer.setStyle({ color: "#9915a7", dashArray: null });
    $(this.map.getContainer()).removeClass("quadrat-editing");

    // 隐藏控制按钮
    this.hideEditControls();

    // 清理状态
    this._editingLayer = null;
    this._editingResultFeature = null;
    this._originalLatLngs = null;

    // 刷新列表
    this.renderQuadratList();
  }

  async confirmGeometryEdit() {
    if (!this._editingLayer) return;

    const layer = this._editingLayer;
    const resultFeature = this._editingResultFeature;

    // 禁用所有编辑模式
    layer.disableEdit();
    if (layer.dragging) layer.dragging.disable();

    // 恢复样式
    layer.setStyle({ color: "#9915a7", dashArray: null });

    // 获取新的坐标
    const newLatLngs = layer.getLatLngs()[0];
    const newCoords = newLatLngs.map((ll) => [ll.lng, ll.lat]);

    // 更新 resultFeature 中的坐标
    if (resultFeature && resultFeature._quadratProps) {
      resultFeature._quadratProps.vertices = newCoords.map((c) => ({
        lon: c[0],
        lat: c[1],
      }));
      // 重新计算中心点
      if (newCoords.length > 0) {
        const cx = newCoords.reduce((s, c) => s + c[0], 0) / newCoords.length;
        const cy = newCoords.reduce((s, c) => s + c[1], 0) / newCoords.length;
        resultFeature._quadratProps.centroid = { lon: cx, lat: cy };
      }
    }

    // 恢复样式
    $(this.map.getContainer()).removeClass("quadrat-editing");

    // 隐藏控制按钮
    this.hideEditControls();

    // 清理状态
    this._editingLayer = null;
    this._editingResultFeature = null;
    this._originalLatLngs = null;

    // 更新气泡 marker 位置
    const raw = resultFeature && resultFeature._quadratProps && resultFeature._quadratProps.raw;
    const qName = raw && raw.sort_no;
    if (qName && layer.getBounds) {
      this.addNameMarker(layer, qName, layer.getBounds().getCenter());
    }

    // 提交到后端
    await this.updateQuadratGeometry();

    // 刷新列表
    this.renderQuadratList();
  }

  async updateQuadratGeometry() {
    const sid = await this.getSamplingId();
    if (!sid) {
      alert(_("无法获取样品号"));
      return;
    }

    // 收集所有样方数据
    const all = this.getQuadratsFromMap();
    if (all.length === 0) return;
    const payload = all.map((item) => item.payload);

    try {
      const response = await fetch(
        `${this.apiBase}/api/odm/samplings/${sid}/statistics`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!(response.status === 200 || response.status === 202)) {
        alert(_("更新样方范围失败: ") + response.status);
        return;
      }

      console.log("[Quadrat] Geometry updated successfully");
      // 重新生成统计
      this.generateAllQuadratStats();
    } catch (e) {
      alert(_("更新样方范围失败: 网络错误"));
    }
  }

  promptQuadratName(callback) {
    // 生成默认名称：当前时间精确到秒
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    const second = String(now.getSeconds()).padStart(2, "0");
    const defaultName = `${year}${month}${day}${hour}${minute}${second}`;

    // 创建模态对话框
    const $overlay = $('<div class="quadrat-name-modal-overlay"/>');
    const $modal = $(`
      <div class="quadrat-name-modal">
        <h3>${_("输入样方名称")}</h3>
        <input type="text" class="quadrat-name-input" value="${defaultName}" />
        <div class="quadrat-name-actions">
          <button class="btn btn-primary quadrat-name-confirm">${_("确认")}</button>
          <button class="btn btn-default quadrat-name-cancel">${_("取消")}</button>
        </div>
      </div>
    `);
    $overlay.append($modal);
    $("body").append($overlay);

    const $input = $modal.find(".quadrat-name-input");
    $input.focus().select();

    // 确认按钮
    $modal.find(".quadrat-name-confirm").on("click", () => {
      const name = $input.val().trim() || defaultName;
      $overlay.remove();
      callback(name);
    });

    // 取消按钮
    $modal.find(".quadrat-name-cancel").on("click", () => {
      $overlay.remove();
      // 取消时也使用默认名称
      callback(defaultName);
    });

    // 回车确认
    $input.on("keypress", (e) => {
      if (e.which === 13) {
        const name = $input.val().trim() || defaultName;
        $overlay.remove();
        callback(name);
      }
    });
  }

  renderQuadratList() {
    const items = [];
    this.map.eachLayer((layer) => {
      const mp = layer._measurePopup;
      if (mp && mp.state && mp.state.featureType === "Polygon") {
        const gj = mp.getGeoJSON();
        const coords =
          gj.geometry && gj.geometry.coordinates && gj.geometry.coordinates[0]
            ? gj.geometry.coordinates[0]
            : [];
        if (coords.length) {
          const closed =
            coords[0][0] === coords[coords.length - 1][0] &&
            coords[0][1] === coords[coords.length - 1][1];
          const verts = closed ? coords.slice(0, -1) : coords;
          const bounds = L.latLngBounds(verts.map((v) => L.latLng(v[1], v[0])));
          const raw =
            (mp &&
              mp.props &&
              mp.props.resultFeature &&
              mp.props.resultFeature._quadratProps &&
              mp.props.resultFeature._quadratProps.raw) ||
            null;
          const id = raw ? raw.id : null;
          const name = raw && raw.sort_no ? raw.sort_no : null;
          items.push({ layer, bounds, id, name });
        }
      }
    });

    const $startPrompt = $(this.measure.$startPrompt);
    let $cont = $startPrompt.children(".quadrat-created");
    if ($cont.length === 0) {
      $cont = $('<div class="quadrat-created"/>');
      $startPrompt.children("ul.tasks").before($cont);
    }
    $cont.empty();
    if (items.length > 0) {
      const $title = $(`<p class='created-title'>${_("已创建样方")}</p>`);
      $cont.append($title);
      const $ul = $('<ul class="quadrat-list"/>');
      items.forEach((it, idx) => {
        const $li = $(
          '<li class="quadrat-item" data-layer-id="' +
            it.layer._leaflet_id +
            '"/>',
        );
        // 优先使用 name 字段，回退到"样方 N"
        const displayName = it.name || `${_("样方")} ${idx + 1}`;

        // 名称容器（显示模式）
        const $nameWrapper = $('<span class="quadrat-name-wrapper"/>');
        const $nameText = $(
          `<span class="quadrat-name-text" title="${displayName}">${displayName}</span>`,
        );
        const $nameInput = $(
          `<input type="text" class="quadrat-name-edit-input" value="${displayName}" style="display:none;"/>`,
        );
        $nameWrapper.append($nameText).append($nameInput);

        // 样方名称点击聚焦地图
        $nameText.on("click", (e) => {
          e.preventDefault();
          this.map.fitBounds(it.bounds);
        });

        const $actions = $("<span class='actions'></span>");
        const $edit = $(
          "<span href='#' class='edit' title='编辑名称'><i class='fa fa-edit'></i></span>",
        );
        const $confirm = $(
          "<span href='#' class='confirm' title='确认' style='display:none;'><i class='fa fa-check'></i></span>",
        );
        const $loc = $(
          "<a href='#' class='locate' title='定位'><i class='fa fa-crosshairs'></i></a>",
        );
        const $del = $(
          "<a href='#' class='delete' title='删除'><i class='fa fa-trash'></i></a>",
        );

        // 编辑模式切换
        $edit.on("click", (e) => {
          e.preventDefault();
          $nameText.hide();
          $nameInput.show().focus().select();
          $edit.hide();
          $confirm.show();
          $loc.hide();
          $del.hide();
        });

        // 确认编辑
        $confirm.on("click", async (e) => {
          e.preventDefault();
          const newName = $nameInput.val().trim();
          if (!newName) {
            alert(_("样方名称不能为空"));
            return;
          }
          await this.updateQuadratName(it, newName);
          $nameText.text(newName).show();
          $nameInput.hide();
          $confirm.hide();
          $edit.show();
          $loc.show();
          $del.show();
        });

        // 回车确认
        $nameInput.on("keypress", (e) => {
          if (e.which === 13) {
            $confirm.click();
          }
        });

        // ESC 取消
        $nameInput.on("keydown", (e) => {
          if (e.which === 27) {
            $nameInput.val(displayName);
            $nameText.show();
            $nameInput.hide();
            $confirm.hide();
            $edit.show();
            $loc.show();
            $del.show();
          }
        });

        $loc.on("click", (e) => {
          e.preventDefault();
          this.map.fitBounds(it.bounds);
        });
        $del.on("click", async (e) => {
          e.preventDefault();
          await this.deleteQuadrat(it);
        });

        $actions.append($edit);
        $actions.append($confirm);
        $actions.append($loc);
        $actions.append($del);
        $li.append($nameWrapper);
        $li.append($actions);
        $ul.append($li);
      });
      $cont.append($ul);
    }
  }

  getTaskFromMap() {
    console.log("getTaskFromMap", this.injectedTask);
    if (this.injectedTask) return this.injectedTask;

    // 开发模式：使用配置中的固定 project_id 和 task_id
    if (this.devMode && this.devConfig.PROJECT_ID && this.devConfig.TASK_ID) {
      console.log("[DEV] Using fixed task from config:", this.devConfig);
      return {
        project: this.devConfig.PROJECT_ID,
        id: this.devConfig.TASK_ID,
      };
    }

    let found = null;
    this.map.eachLayer((layer) => {
      const meta = layer && layer[Symbol.for("meta")];
      if (meta && meta.task && !found) found = meta.task;
    });
    return found;
  }

  setAllPopupsError(message) {
    const msg = String(message);
    this.map.eachLayer((layer) => {
      const mp = layer._measurePopup;
      if (mp && typeof mp.setState === "function") mp.setState({ error: msg });
    });
  }

  async getSamplingId() {
    if (this.samplingId) return this.samplingId;
    const task = this.getTaskFromMap();
    if (!task) return null;
    const project_id = task.project;
    const task_id = task.id;
    try {
      const r = await fetch(
        `${this.apiBase}/api/odm/samplings/retrieve_or_create`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id, task_id }),
        },
      );
      if (!r.ok) return null;
      const j = await r.json();
      this.samplingId = j.id || j.sampling_id;
      return this.samplingId;
    } catch (e) {
      return null;
    }
  }

  getQuadratsFromMap() {
    const items = [];
    this.map.eachLayer((layer) => {
      const mp = layer._measurePopup;
      if (mp && mp.state && mp.state.featureType === "Polygon") {
        // 直接从 layer 获取最新坐标（而不是从 mp.getGeoJSON()）
        let vertices = [];
        let cx = 0,
          cy = 0;

        if (layer.getLatLngs && layer.getLatLngs()) {
          const latlngs = layer.getLatLngs()[0];
          if (latlngs && latlngs.length > 0) {
            vertices = latlngs.map((ll) => [ll.lng, ll.lat]);
            cx = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
            cy = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;
          }
        }

        if (vertices.length) {
          const idx = String(layer._leaflet_id);
          const raw =
            (mp &&
              mp.props &&
              mp.props.resultFeature &&
              mp.props.resultFeature._quadratProps &&
              mp.props.resultFeature._quadratProps.raw) ||
            {};
          const sort_no = raw.sort_no || "";
          items.push({
            layer,
            payload: { idx, coords: vertices, center: [cx, cy], sort_no },
          });
        }
      }
    });
    return items;
  }

  generateAllQuadratStats() {
    const task = this.getTaskFromMap();
    if (!task) return;
    const all = this.getQuadratsFromMap();
    if (all.length === 0) return;

    // 防止重复提交：检查是否已在处理中
    if (this._isGeneratingStats) {
      console.log(
        "[Quadrat] Stats generation already in progress, skipping...",
      );
      return;
    }

    const payload = all.map((it) => it.payload);
    this.getSamplingId().then((samplingId) => {
      if (!samplingId) return;
      this.samplingId = samplingId;
      this._isGeneratingStats = true;
      $.ajax({
        type: "POST",
        url: `${this.apiBase}/api/odm/samplings/${samplingId}/statistics`,
        data: JSON.stringify(payload),
        contentType: "application/json",
      })
        .done((_r2, _t2, jq2) => {
          if (!(jq2.status === 200 || jq2.status === 202)) {
            const errorMsg = _("统计任务启动失败: ") + jq2.status;
            this.setAllPopupsError(errorMsg);
            alert(_("样方分析提交失败: ") + jq2.status);
            this._isGeneratingStats = false;
            this.removeUnsavedQuadrats();
            this.renderQuadratList();
            return;
          }
          if (this.pollTimer) clearInterval(this.pollTimer);
          let pollCount = 0;
          const maxPollCount = 300; // 最多轮询 300 次（10 分钟）
          this.pollTimer = setInterval(() => {
            pollCount++;
            if (pollCount > maxPollCount) {
              clearInterval(this.pollTimer);
              this.pollTimer = null;
              this._isGeneratingStats = false;
              this.setAllPopupsError(_("统计任务超时"));
              alert(_("样方分析超时（超过10分钟）"));
              this.removeUnsavedQuadrats();
              this.renderQuadratList();
              return;
            }
            $.ajax({
              type: "GET",
              url: `${this.apiBase}/api/odm/samplings/${samplingId}`,
            })
              .done((r3, _t3, jq3) => {
                if (jq3.status !== 200) {
                  this.setAllPopupsError(_("查询失败: ") + jq3.status);
                  clearInterval(this.pollTimer);
                  this.pollTimer = null;
                  this._isGeneratingStats = false;
                  alert(_("样方状态查询失败: ") + jq3.status);
                  this.removeUnsavedQuadrats();
                  this.renderQuadratList();
                  return;
                }
                const progress = r3.progress || 0;
                const state = r3.state || "";

                // 处理失败状态
                if (state === "FAILED") {
                  if (this.pollTimer) {
                    clearInterval(this.pollTimer);
                    this.pollTimer = null;
                  }
                  this._isGeneratingStats = false;
                  const errorMsg = r3.error || r3.err_msg || _("统计任务失败");
                  alert(_("样方分析失败: ") + errorMsg);
                  // 清空当前所有未保存的样方（没有 id 的）
                  this.removeUnsavedQuadrats();
                  this.renderQuadratList();
                  return;
                }

                // 处理完成状态
                if (progress === 100 && state === "COMPLETED") {
                  if (this.pollTimer) {
                    clearInterval(this.pollTimer);
                    this.pollTimer = null;
                  }
                  this._isGeneratingStats = false;
                  const quadrats = Array.isArray(r3.quadrats)
                    ? r3.quadrats
                    : [];
                  const byName = {};
                  for (let i = 0; i < quadrats.length; i++) {
                    const q = quadrats[i];
                    if (q && q.idx !== undefined && q.idx !== null)
                      byName[String(q.idx)] = q;
                  }

                  this.map.eachLayer((layer) => {
                    const mp = layer._measurePopup;
                    if (mp && mp.state && mp.state.featureType === "Polygon") {
                      const gj = mp.getGeoJSON();
                      const coords =
                        gj.geometry &&
                        gj.geometry.coordinates &&
                        gj.geometry.coordinates[0]
                          ? gj.geometry.coordinates[0]
                          : [];
                      const closed =
                        coords.length &&
                        coords[0][0] === coords[coords.length - 1][0] &&
                        coords[0][1] === coords[coords.length - 1][1];
                      const verts = closed ? coords.slice(0, -1) : coords;
                      const idx = String(layer._leaflet_id);
                      // TODO 写死第一个测试
                      const matched = byName[idx];
                      const vertices =
                        matched && matched.coords
                          ? matched.coords.map((v) => ({
                              lon: v[0],
                              lat: v[1],
                            }))
                          : verts.map((v) => ({ lon: v[0], lat: v[1] }));
                      let cx = null,
                        cy = null;
                      if (
                        matched &&
                        matched.center &&
                        matched.center.length === 2
                      ) {
                        cx = matched.center[0];
                        cy = matched.center[1];
                      } else if (vertices.length) {
                        cx =
                          vertices.reduce((s, v) => s + v.lon, 0) /
                          vertices.length;
                        cy =
                          vertices.reduce((s, v) => s + v.lat, 0) /
                          vertices.length;
                      }
                      const reflectance = {};
                      const indices = {};
                      const statsArr =
                        matched && matched.statistics ? matched.statistics : [];
                      for (let k = 0; k < statsArr.length; k++) {
                        const s = statsArr[k];
                        const v = {
                          min: s.dn_min.toFixed(2),
                          max: s.dn_max.toFixed(2),
                          mean: s.dn_mean.toFixed(2),
                          std: s.dn_std.toFixed(2),
                        };
                        const an = (s.algo_name || "").toLowerCase();
                        if (an === "r") reflectance.Red = v;
                        else if (an === "g") reflectance.Green = v;
                        else if (an === "b") reflectance.Blue = v;
                        else if (an === "re") reflectance.RE = v;
                        else if (an === "n") reflectance.NIR = v;
                        else if (an === "ndvi") indices.NDVI = v;
                        else if (an === "gndvi") indices.GNDVI = v;
                        else if (an === "ndre") indices.NDRE = v;
                      }
                      const stats = {
                        vertices,
                        centroid: { lon: cx, lat: cy },
                        reflectance,
                        indices,
                        raw: matched,
                      };
                      if (mp && mp.props && mp.props.resultFeature)
                        mp.props.resultFeature._quadratProps = stats;
                      if (typeof mp.setState === "function")
                        mp.setState({ error: "" });
                      // 添加/更新名称气泡 marker
                      const qName = (matched && matched.sort_no) || '';
                      const qCenter = cy != null && cx != null ? L.latLng(cy, cx) : null;
                      if (qName && qCenter) this.addNameMarker(layer, qName, qCenter);
                    }
                  });
                }
              })
              .fail((err) => {
                this.setAllPopupsError(err);
                clearInterval(this.pollTimer);
                this.pollTimer = null;
                this._isGeneratingStats = false;
                alert(
                  _("样方状态查询失败: ") +
                    (err && err.status ? err.status : _("网络错误")),
                );
                this.removeUnsavedQuadrats();
                this.renderQuadratList();
              });
          }, 2000);
        })
        .fail((err) => {
          const errorMsg =
            err && err.status
              ? _("统计任务启动失败: ") + err.status
              : _("统计任务启动失败");
          this.setAllPopupsError(errorMsg);
          alert(
            _("样方分析提交失败: ") +
              (err && err.status ? err.status : _("网络错误")),
          );
          this._isGeneratingStats = false;
          this.removeUnsavedQuadrats();
          this.renderQuadratList();
        });
    });
  }

  async exportAllToExcel() {
    const sid = await this.getSamplingId();
    // 判断当前是否有样方数据
    let hasFeatures = false;
    this.map.eachLayer((layer) => {
      if (layer._measurePopup) hasFeatures = true;
    });
    if (!hasFeatures) {
      alert(_("当前无样方数据，请圈画样方后再导出"));
      return;
    }
    if (!sid) return;
    const r2 = await fetch(
      `${this.apiBase}/api/odm/samplings/${sid}/export_to_excel`,
    );
    if (!r2.ok) return;
    const data = await r2.json();
    console.log(`${this.apiBase}/${data}`);
    window.top.dispatchEvent(
      new CustomEvent("openFile", {
        detail: { type: "saveFile", files: [`${this.apiBase}/${data}`] },
      }),
    );
  }

  async initEcho() {
    const sid = await this.getSamplingId();
    if (!sid) return;
    try {
      const r = await fetch(`${this.apiBase}/api/odm/samplings/${sid}`);
      if (!r.ok) return;
      const data = await r.json();
      const quadrats = Array.isArray(data.quadrats) ? data.quadrats : [];
      quadrats.forEach((q) => this.addQuadratLayer(q));
      this.renderQuadratList();
    } catch (e) {
      /* ignore */
    }
  }

  addNameMarker(layer, name, latlng) {
    this.removeNameMarker(layer);
    if (!name || !latlng) return;
    const icon = L.divIcon({
      className: 'quadrat-name-bubble',
      html: `<div class="quadrat-name-bubble-inner">${$('<span/>').text(name).html()}</div>`,
      iconSize: null,
      iconAnchor: [0, 0]
    });
    const marker = L.marker(latlng, { icon, interactive: false, pane: 'tooltipPane' }).addTo(this.map);
    layer._nameMarker = marker;
  }

  removeNameMarker(layer) {
    if (layer && layer._nameMarker) {
      if (this.map.hasLayer(layer._nameMarker)) layer._nameMarker.remove();
      layer._nameMarker = null;
    }
  }

  addQuadratLayer(q) {
    const latlngs = (q.coords || []).map((c) => L.latLng(c[1], c[0]));
    if (latlngs.length === 0) return;
    const poly = L.polygon(latlngs, { color: "#9915a7" }).addTo(this.map);
    poly.options.bounds = L.latLngBounds(latlngs);
    const reflectance = {};
    const indices = {};
    const statsArr = Array.isArray(q.statistics) ? q.statistics : [];
    for (let k = 0; k < statsArr.length; k++) {
      const s = statsArr[k];
      const v = {
        min: s.dn_min.toFixed(2),
        max: s.dn_max.toFixed(2),
        mean: s.dn_mean.toFixed(2),
        std: s.dn_std.toFixed(2),
      };
      const an = (s.algo_name || "").toLowerCase();
      if (an === "r") reflectance.Red = v;
      else if (an === "g") reflectance.Green = v;
      else if (an === "b") reflectance.Blue = v;
      else if (an === "re") reflectance.RE = v;
      else if (an === "n") reflectance.NIR = v;
      else if (an === "ndvi") indices.NDVI = v;
      else if (an === "gndvi") indices.GNDVI = v;
      else if (an === "ndre") indices.NDRE = v;
    }
    const vertices = (q.coords || []).map((v) => ({ lon: v[0], lat: v[1] }));
    const centroid =
      q.center && q.center.length === 2
        ? { lon: q.center[0], lat: q.center[1] }
        : null;
    const R = 6378137;
    const deg = Math.PI / 180;
    const coords = q.coords || [];
    const latAvg = coords.length
      ? coords.reduce((s, c) => s + c[1], 0) / coords.length
      : 0;
    const toXY = (c) => [
      c[0] * deg * R * Math.cos(latAvg * deg),
      c[1] * deg * R,
    ];
    let area = 0;
    if (coords.length >= 3) {
      const ring = coords.slice();
      if (
        !(
          ring[0][0] === ring[ring.length - 1][0] &&
          ring[0][1] === ring[ring.length - 1][1]
        )
      )
        ring.push(ring[0]);
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = toXY(ring[i]);
        const [x2, y2] = toXY(ring[i + 1]);
        area += x1 * y2 - x2 * y1;
      }
      area = Math.abs(area) / 2;
    }
    const haversine = (a, b) => {
      const lat1 = a.lat * deg,
        lon1 = a.lng * deg;
      const lat2 = b.lat * deg,
        lon2 = b.lng * deg;
      const dlat = lat2 - lat1,
        dlon = lon2 - lon1;
      const h =
        Math.sin(dlat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    let length = 0;
    if (latlngs.length >= 2) {
      for (let i = 0; i < latlngs.length; i++) {
        const a = latlngs[i];
        const b = latlngs[(i + 1) % latlngs.length];
        length += haversine(a, b);
      }
    }
    const us = unitSystem();
    const model = {
      lengthDisplay: us.length(length).toString(),
      areaDisplay: us.area(area).toString(),
      length,
      area,
    };
    const resultFeature = {
      toGeoJSON: (precision) => ({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            (q.coords || []).concat(
              q.coords && q.coords[0] ? [q.coords[0]] : [],
            ),
          ],
        },
        properties: {
          Length: us.length(length).value,
          Area: us.area(area).value,
          Vertices: vertices,
          Centroid: centroid || {},
          Reflectance: reflectance,
          Indices: indices,
          UnitSystem: "metric",
        },
      }),
    };
    resultFeature._quadratProps = {
      vertices,
      centroid: centroid || {},
      reflectance,
      indices,
      raw: q,
    };
    const mp = {
      state: { featureType: "Polygon" },
      getGeoJSON: () => resultFeature.toGeoJSON(14),
      props: { resultFeature },
    };
    poly._measurePopup = mp;
    // 添加名称气泡 marker
    const nameLabel = q.sort_no || '';
    const centerLatLng = centroid ? L.latLng(centroid.lat, centroid.lon) : (latlngs.length ? L.latLngBounds(latlngs).getCenter() : null);
    if (nameLabel && centerLatLng) this.addNameMarker(poly, nameLabel, centerLatLng);
    poly.on("click", (e) => {
      const container = document.createElement("div");
      const popup = L.popup({ className: "quadrat-popup" })
        .setLatLng(e.latlng)
        .setContent(container);
      popup.openOn(this.map);
      ReactDOM.render(
        <QuadratPopup
          model={model}
          resultFeature={resultFeature}
          map={this.map}
          onEditGeometry={() => this.startGeometryEdit(poly, resultFeature)}
        />,
        container,
      );
    });
  }

  async updateQuadratName(it, newName) {
    // 更新本地数据
    const mp = it.layer && it.layer._measurePopup;
    if (
      mp &&
      mp.props &&
      mp.props.resultFeature &&
      mp.props.resultFeature._quadratProps
    ) {
      if (!mp.props.resultFeature._quadratProps.raw) {
        mp.props.resultFeature._quadratProps.raw = {};
      }
      mp.props.resultFeature._quadratProps.raw.sort_no = newName;
    }

    // 全量提交到后端（与新增一致）
    const sid = await this.getSamplingId();
    if (!sid) {
      alert(_("无法获取样品号"));
      return;
    }

    // 收集所有样方数据（包括刚修改的）
    const all = this.getQuadratsFromMap();
    if (all.length === 0) return;
    const payload = all.map((item) => item.payload);

    try {
      const response = await fetch(
        `${this.apiBase}/api/odm/samplings/${sid}/statistics`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!(response.status === 200 || response.status === 202)) {
        alert(_("更新样方名称失败: ") + response.status);
        this.renderQuadratList(); // 恢复显示
        return;
      }

      console.log("[Quadrat] Name updated successfully:", newName);
      // 更新气泡 marker
      if (it.layer) {
        const bounds = it.layer.getBounds();
        if (bounds) this.addNameMarker(it.layer, newName, bounds.getCenter());
      }
      // 刷新列表显示新名称
      this.renderQuadratList();
    } catch (e) {
      alert(_("更新样方名称失败: 网络错误"));
      this.renderQuadratList();
    }
  }

  async deleteQuadrat(it) {
    const sid = await this.getSamplingId();
    if (!sid) {
      alert(_("无法获取样品号"));
      return;
    }
    const qid = it.id;
    if (!qid) {
      if (it.layer && this.map.hasLayer(it.layer)) {
        this.removeNameMarker(it.layer);
        it.layer.remove();
        this.renderQuadratList();
      }
      return;
    }
    try {
      const r = await fetch(
        `${this.apiBase}/api/odm/samplings/${sid}/quadrat/${qid}`,
        { method: "DELETE" },
      );
      if (r.status === 204) {
        if (it.layer && this.map.hasLayer(it.layer)) {
          this.removeNameMarker(it.layer);
          it.layer.remove();
          this.renderQuadratList();
        }
        this.map.closePopup();
        this.hideGlobalTooltip();
      } else {
        alert(_("删除失败: ") + r.status);
      }
    } catch (e) {
      alert(_("删除失败"));
    }
  }

  removeUnsavedQuadrats() {
    // 清空所有未保存的样方（没有 raw.id 的）
    const layersToRemove = [];
    this.map.eachLayer((layer) => {
      const mp = layer._measurePopup;
      if (mp && mp.state && mp.state.featureType === "Polygon") {
        const raw =
          (mp &&
            mp.props &&
            mp.props.resultFeature &&
            mp.props.resultFeature._quadratProps &&
            mp.props.resultFeature._quadratProps.raw) ||
          null;
        const hasId = raw && raw.id;
        if (!hasId) {
          // 未保存的样方，标记删除
          layersToRemove.push(layer);
        }
      }
    });

    // 批量删除
    layersToRemove.forEach((layer) => {
      this.removeNameMarker(layer);
      if (this.map.hasLayer(layer)) {
        layer.remove();
      }
    });

    // 关闭弹窗
    this.map.closePopup();
    this.hideGlobalTooltip();

    console.log(`[Quadrat] Removed ${layersToRemove.length} unsaved quadrats`);
  }

  hideGlobalTooltip() {
    const el = document.querySelector(".quad-tooltip");
    if (el) el.style.display = "none";
  }
}
