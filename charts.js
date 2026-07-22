// ============================================================
// War Room — SVG Chart Components
// Lightweight, zero-dependency chart primitives for inline use.
//
// Usage:  React.createElement(Sparkline, { data: [1,2,3] })
//         React.createElement(BarChart,  { items: [...] })
//         React.createElement(RadarChart, { values: {QB:80, RB:60, ...} })
//         React.createElement(MiniDonut, { value: 72 })
//
// All components use React.createElement (no JSX) and render
// pure SVG — no external libraries needed.
// ============================================================

var CHART_COLORS = {
    gold:   '#D4AF37',
    green:  '#2ECC71',
    red:    '#E74C3C',
    silver: '#C0C0C0',
    black:  '#0A0A0A',
    offBlack: '#1A1A1A',
    charcoal: '#2A2A2A',
    white:  '#FFFFFF',
};

// ── 1. Sparkline ─────────────────────────────────────────────
// Tiny inline line chart for KPI cards and player rows.
//
// Props:
//   data      — number[]  (required)
//   width     — number    (default 100)
//   height    — number    (default 30)
//   color     — string    (default CHART_COLORS.gold)
//   showDots  — boolean   (default false)
//   fillArea  — boolean   (default true)  subtle gradient fill under line

function Sparkline(props) {
    var data   = props.data || [];
    var w      = props.width  || 100;
    var h      = props.height || 30;
    var color  = props.color  || CHART_COLORS.gold;
    var dots   = props.showDots || false;
    var fill   = props.fillArea !== undefined ? props.fillArea : true;

    if (data.length < 2) {
        return React.createElement('svg', { width: w, height: h });
    }

    var pad    = dots ? 3 : 1;          // breathing room for dot radius
    var min    = Math.min.apply(null, data);
    var max    = Math.max.apply(null, data);
    var range  = max - min || 1;
    var stepX  = (w - pad * 2) / (data.length - 1);

    // Build points
    var points = data.map(function(v, i) {
        var x = pad + i * stepX;
        var y = pad + (1 - (v - min) / range) * (h - pad * 2);
        return { x: x, y: y };
    });

    var linePath = points.map(function(p, i) {
        return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join(' ');

    var gradientId = 'spark-grad-' + Math.random().toString(36).slice(2, 8);

    var children = [];

    // Gradient fill area
    if (fill) {
        var areaPath = linePath +
            ' L' + points[points.length - 1].x.toFixed(1) + ',' + h +
            ' L' + points[0].x.toFixed(1) + ',' + h + ' Z';

        children.push(
            React.createElement('defs', { key: 'defs' },
                React.createElement('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' },
                    React.createElement('stop', { offset: '0%',   stopColor: color, stopOpacity: '0.3' }),
                    React.createElement('stop', { offset: '100%', stopColor: color, stopOpacity: '0.02' })
                )
            )
        );
        children.push(
            React.createElement('path', {
                key: 'area', d: areaPath,
                fill: 'url(#' + gradientId + ')', stroke: 'none'
            })
        );
    }

    // Line
    children.push(
        React.createElement('path', {
            key: 'line', d: linePath,
            fill: 'none', stroke: color, strokeWidth: 1.5,
            strokeLinecap: 'round', strokeLinejoin: 'round'
        })
    );

    // Dots
    if (dots) {
        points.forEach(function(p, i) {
            children.push(
                React.createElement('circle', {
                    key: 'dot-' + i, cx: p.x, cy: p.y, r: 2,
                    fill: color, stroke: CHART_COLORS.black, strokeWidth: 0.5
                })
            );
        });
    }

    // Endpoint dot (always shown, last value highlighted)
    var last = points[points.length - 1];
    children.push(
        React.createElement('circle', {
            key: 'end', cx: last.x, cy: last.y, r: 2.5,
            fill: color, stroke: CHART_COLORS.black, strokeWidth: 0.75
        })
    );

    return React.createElement('svg', {
        width: w, height: h,
        viewBox: '0 0 ' + w + ' ' + h,
        style: { display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }
    }, children);
}


// ── 2. BarChart (horizontal) ─────────────────────────────────
// Horizontal bar chart for analytics panels.
//
// Props:
//   items    — [{label, value, color?}]  (required)
//   maxValue — number   (default: auto from data)
//   height   — number   (per-bar height, default 22)
//   width    — number   (total width, default 260)
//   gap      — number   (vertical gap, default 6)

function BarChart(props) {
    var items    = props.items || [];
    var maxVal   = props.maxValue || Math.max.apply(null, items.map(function(d) { return d.value; })) || 1;
    var barH     = props.height || 22;
    var totalW   = props.width  || 260;
    var gap      = props.gap    || 6;
    var labelW   = 60;                       // space reserved for labels
    var barAreaW = totalW - labelW - 40;     // 40px for value text on right

    var totalH   = items.length * (barH + gap) - gap;

    var children = items.map(function(item, i) {
        var y      = i * (barH + gap);
        var pct    = Math.min(item.value / maxVal, 1);
        var barW   = Math.max(pct * barAreaW, 2);
        var color  = item.color || CHART_COLORS.gold;

        var gradId = 'bar-g-' + i + '-' + Math.random().toString(36).slice(2, 6);

        return React.createElement('g', { key: 'bar-' + i },
            // Gradient definition per bar
            React.createElement('defs', null,
                React.createElement('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '1', y2: '0' },
                    React.createElement('stop', { offset: '0%',   stopColor: color, stopOpacity: '0.9' }),
                    React.createElement('stop', { offset: '100%', stopColor: color, stopOpacity: '0.5' })
                )
            ),
            // Label
            React.createElement('text', {
                x: labelW - 6, y: y + barH / 2,
                textAnchor: 'end', dominantBaseline: 'central',
                fill: CHART_COLORS.silver,
                style: { fontSize: '11px', fontFamily: 'Inter, sans-serif', fontWeight: 400 }
            }, item.label),
            // Background track
            React.createElement('rect', {
                x: labelW, y: y, width: barAreaW, height: barH,
                rx: 3, fill: 'rgba(255,255,255,0.04)'
            }),
            // Filled bar
            React.createElement('rect', {
                x: labelW, y: y, width: barW, height: barH,
                rx: 3, fill: 'url(#' + gradId + ')'
            }),
            // Value text
            React.createElement('text', {
                x: labelW + barAreaW + 6, y: y + barH / 2,
                textAnchor: 'start', dominantBaseline: 'central',
                fill: CHART_COLORS.white,
                style: { fontSize: '11px', fontFamily: 'Inter, sans-serif', fontWeight: 600 }
            }, typeof item.value === 'number' ? item.value.toFixed(1) : item.value)
        );
    });

    return React.createElement('svg', {
        width: totalW, height: totalH,
        viewBox: '0 0 ' + totalW + ' ' + totalH,
        style: { display: 'block', overflow: 'visible' }
    }, children);
}


// ── 3. RadarChart ────────────────────────────────────────────
// Position-balance radar for roster composition.
//
// Props:
//   values — { QB:0-100, RB:0-100, WR:0-100, TE:0-100, ... }  (required)
//   size   — number (default 180)
//   color  — string (default CHART_COLORS.gold)

function RadarChart(props) {
    var values = props.values || {};
    var size   = props.size   || 180;
    var color  = props.color  || CHART_COLORS.gold;

    var keys   = Object.keys(values);
    var n      = keys.length;
    if (n < 3) {
        return React.createElement('svg', { width: size, height: size });
    }

    var cx     = size / 2;
    var cy     = size / 2;
    var radius = size / 2 - 24;          // leave room for labels
    var angleStep = (2 * Math.PI) / n;
    var startAngle = -Math.PI / 2;       // start at top

    // Helper: polar to cartesian
    function polar(angle, r) {
        return {
            x: cx + r * Math.cos(angle),
            y: cy + r * Math.sin(angle)
        };
    }

    var children = [];

    // Background rings (20%, 40%, 60%, 80%, 100%)
    [0.2, 0.4, 0.6, 0.8, 1.0].forEach(function(pct, ri) {
        var r = radius * pct;
        var ringPts = [];
        for (var i = 0; i < n; i++) {
            var a = startAngle + i * angleStep;
            var p = polar(a, r);
            ringPts.push((i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1));
        }
        ringPts.push('Z');
        children.push(
            React.createElement('path', {
                key: 'ring-' + ri,
                d: ringPts.join(' '),
                fill: 'none',
                stroke: 'rgba(255,255,255,' + (pct === 1 ? '0.15' : '0.06') + ')',
                strokeWidth: pct === 1 ? 1 : 0.5
            })
        );
    });

    // Axis lines
    for (var i = 0; i < n; i++) {
        var a = startAngle + i * angleStep;
        var outerPt = polar(a, radius);
        children.push(
            React.createElement('line', {
                key: 'axis-' + i,
                x1: cx, y1: cy,
                x2: outerPt.x, y2: outerPt.y,
                stroke: 'rgba(255,255,255,0.08)', strokeWidth: 0.5
            })
        );
    }

    // Data polygon
    var gradId = 'radar-fill-' + Math.random().toString(36).slice(2, 8);
    var dataPts = [];
    var dataPoints = [];
    keys.forEach(function(key, i) {
        var val = Math.max(0, Math.min(100, values[key] || 0));
        var a   = startAngle + i * angleStep;
        var r   = radius * (val / 100);
        var p   = polar(a, r);
        dataPts.push((i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1));
        dataPoints.push(p);
    });
    dataPts.push('Z');

    children.push(
        React.createElement('defs', { key: 'radar-defs' },
            React.createElement('radialGradient', { id: gradId, cx: '50%', cy: '50%', r: '50%' },
                React.createElement('stop', { offset: '0%',   stopColor: color, stopOpacity: '0.35' }),
                React.createElement('stop', { offset: '100%', stopColor: color, stopOpacity: '0.08' })
            )
        )
    );

    children.push(
        React.createElement('path', {
            key: 'data-fill', d: dataPts.join(' '),
            fill: 'url(#' + gradId + ')',
            stroke: color, strokeWidth: 1.5, strokeLinejoin: 'round'
        })
    );

    // Data dots
    dataPoints.forEach(function(p, i) {
        children.push(
            React.createElement('circle', {
                key: 'dp-' + i, cx: p.x, cy: p.y, r: 3,
                fill: color, stroke: CHART_COLORS.black, strokeWidth: 1
            })
        );
    });

    // Labels
    keys.forEach(function(key, i) {
        var a = startAngle + i * angleStep;
        var lp = polar(a, radius + 14);
        var anchor = 'middle';
        if (Math.cos(a) < -0.1) anchor = 'end';
        if (Math.cos(a) >  0.1) anchor = 'start';
        children.push(
            React.createElement('text', {
                key: 'lbl-' + i, x: lp.x, y: lp.y,
                textAnchor: anchor, dominantBaseline: 'central',
                fill: CHART_COLORS.silver,
                style: { fontSize: '10px', fontFamily: 'Inter, sans-serif', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }
            }, key)
        );
    });

    return React.createElement('svg', {
        width: size, height: size,
        viewBox: '0 0 ' + size + ' ' + size,
        style: { display: 'block', overflow: 'visible' }
    }, children);
}


// ── 4. MiniDonut ─────────────────────────────────────────────
// Small ring/donut chart for health scores and percentages.
//
// Props:
//   value — 0-100  (required)
//   size  — number (default 64)
//   color — string (default: auto — green > gold > red based on value)
//   label — string (optional, displayed below the number)
//   thickness — number (stroke width, default 6)

function MiniDonut(props) {
    var value     = Math.max(0, Math.min(100, props.value || 0));
    var size      = props.size  || 64;
    var thickness = props.thickness || 6;
    var label     = props.label || null;

    // Auto-color: green for good, gold for mid, red for low
    var color = props.color;
    if (!color) {
        if (value >= 70)      color = CHART_COLORS.green;
        else if (value >= 40) color = CHART_COLORS.gold;
        else                  color = CHART_COLORS.red;
    }

    var cx     = size / 2;
    var cy     = size / 2;
    var r      = (size - thickness) / 2 - 1;
    var circ   = 2 * Math.PI * r;
    var offset = circ * (1 - value / 100);

    var children = [];

    // Background ring
    children.push(
        React.createElement('circle', {
            key: 'bg', cx: cx, cy: cy, r: r,
            fill: 'none', stroke: 'rgba(255,255,255,0.06)',
            strokeWidth: thickness
        })
    );

    // Value arc
    children.push(
        React.createElement('circle', {
            key: 'arc', cx: cx, cy: cy, r: r,
            fill: 'none', stroke: color,
            strokeWidth: thickness,
            strokeDasharray: circ,
            strokeDashoffset: offset,
            strokeLinecap: 'round',
            transform: 'rotate(-90 ' + cx + ' ' + cy + ')',
            style: { transition: 'stroke-dashoffset 0.6s ease' }
        })
    );

    // Center number
    children.push(
        React.createElement('text', {
            key: 'val', x: cx, y: label ? cy - 4 : cy,
            textAnchor: 'middle', dominantBaseline: 'central',
            fill: CHART_COLORS.white,
            style: { fontSize: Math.round(size * 0.28) + 'px', fontFamily: 'Rajdhani, sans-serif', fontWeight: 400 }
        }, Math.round(value))
    );

    // Optional label below the number
    if (label) {
        children.push(
            React.createElement('text', {
                key: 'lbl', x: cx, y: cy + Math.round(size * 0.18),
                textAnchor: 'middle', dominantBaseline: 'central',
                fill: CHART_COLORS.silver,
                style: { fontSize: Math.max(8, Math.round(size * 0.13)) + 'px', fontFamily: 'Inter, sans-serif', fontWeight: 300, textTransform: 'uppercase', letterSpacing: '0.06em' }
            }, label)
        );
    }

    return React.createElement('svg', {
        width: size, height: size,
        viewBox: '0 0 ' + size + ' ' + size,
        style: { display: 'inline-block', verticalAlign: 'middle' }
    }, children);
}
