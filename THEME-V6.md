# 里间 v6 卡片主题

v6 将应用卡片交给主题层控制。默认卡片不再生成装饰线，页面里也没有位于自定义主题之后的强制覆盖规则。

## 卡片配置

`.pvtheme` 的 `cards.colorMode` 支持三种值：

- `original`：保留每个应用原本的颜色。
- `uniform`：所有卡片使用 `palette` 第一组颜色。
- `cycle`：按照卡片顺序循环使用 `palette`。

`palette` 的每一项为 `[背景色, 前景色]`。`variants` 是一组 CSS 变量对象，会按卡片顺序循环应用，适合制作高低、旋转、尺寸或阴影的规律错落。例如：

```json
"cards": {
  "colorMode": "cycle",
  "palette": [["#442f35", "#fff5e9"], ["#293c3b", "#edf8ee"]],
  "variants": [
    { "--card-icon-transform": "translateY(0) rotate(-1deg)" },
    { "--card-icon-transform": "translateY(7px) rotate(1deg)" }
  ]
}
```

## 常用变量

- 网格：`--card-grid-row-gap`、`--card-grid-column-gap`
- 尺寸：`--card-width`、`--card-aspect-ratio`、`--card-radius`
- 边框：`--card-border-width`、`--card-border-style`、`--card-border-color`
- 阴影与位置：`--card-shadow`、`--card-icon-margin`、`--card-icon-transform`
- 上传图片：`--card-icon-padding`、`--card-image-fit`、`--card-image-radius`、`--card-image-filter`、`--card-image-opacity`
- 文字：`--card-text-align`、`--card-title-size`、`--card-title-weight`、`--card-copy-position`、`--card-copy-inset`、`--card-copy-padding`、`--card-copy-background`

文字要覆盖在图标上时，可把 `--card-copy-position` 设为 `absolute`，再使用 `--card-copy-inset` 定位。主题 CSS 仍然拥有最终控制权，可以直接调整 `.card-copy`、标题、副标题和标签。

## 三个独立装饰层

- 装饰线：`--card-decoration-line-display`
- 内框：`--card-inner-frame-display`
- 高光：`--card-highlight-display`

三者默认都是 `none`。设为 `block` 后，可以继续使用同名前缀变量改变位置、边框、背景、圆角、阴影、透明度与变换。装饰线可以改成横线、斜线、图片或任意渐变，不再被本体固定成竖线。

## CSS 精确控制

每张卡片带有 `data-card-index`，上传图标的卡片另带 `data-has-icon="true"`。主题可以用 `:nth-child()` 制作规律变化，也可以只改变上传图片：

```css
.app-card:nth-child(even) { --card-icon-transform: translateY(6px); }
.app-card[data-has-icon="true"] { --card-icon-padding: 5px; --card-image-radius: 18%; }
```
