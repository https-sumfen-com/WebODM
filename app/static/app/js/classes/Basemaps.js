import { _ } from './gettext';

export default [
  {
    attribution: "谷歌地图",
    subdomains: [
      "7abac8c11716f6949e7b23f76e60fcd0",
      "444c94a4157de3c06c435132eb2f1ac5",
    ],
    maxZoom: 21,
    minZoom: 3,
    label: _("谷歌地图"),
    url: "https://maps.hk.sumfen.com/{s}/kh?v=904&hl=zh-CN&x={x}&y={y}&z={z}",
  },
  {
    attribution: "星图地球",
    maxZoom: 18,
    minZoom: 3,
    label: _("星图地球"),
    url: "http://tiles1.geovisearth.com/base/v1/img/{z}/{x}/{y}?format=webp&tmsIds=w&token=afba1316bcd8e1e58d95ee480a61369fd542660819848ac9ef191c563ded201f",
  },
  {
    attribution: "天地图",
    minZoom: 3,
    maxZoom: 18,
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    key: "bd41a94262676f6696917728b37a5663",
    detectRetina: true,
    label: _("天地图"),
    url: "https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk={key}",
  },
];
