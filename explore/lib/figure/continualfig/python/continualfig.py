"""continualfig for Python: loaded at interpreter start (sitecustomize) before an Analysis step runs.

It applies the Continual style, keeps seaborn's set_theme() from undoing it, and wraps Figure.savefig so a figure is
(1) drawn at a journal width in mm, (2) improved where its own objects say how, and (3) saved with its figure record.
The script is never edited. CONTINUALFIG=off gives the unstyled output.
"""
import json
import os

import matplotlib as mpl
from cycler import cycler

INK, GREY, NULL = "#141516", "#8b918c", "#b9bdb9"
PALETTE = ["#2f6f9f", "#b35a1f", "#5b8a3c", "#7a5195", "#b38a2e", "#3f8f8a"]
DOWN, UP = "#2f6f9f", "#b35a1f"
MM = 1 / 25.4
WIDTH_MM = {"single": 89, "onehalf": 120, "double": 183}
FONT = os.environ.get("CONTINUALFIG_FONT", "Arial")
# CONTINUALFIG: on = style and rules (research prototype), record = draw as written and only write the figure record
# (what Proof uses, so a model does every improvement), off = nothing.
MODE = os.environ.get("CONTINUALFIG", "on")
ON = MODE == "on"
RECORDS = os.environ.get("CONTINUALFIG_RECORDS", ".")
WIDTH_OPT = os.environ.get("CONTINUALFIG_WIDTH", "")
FONT_PT = float(os.environ.get("CONTINUALFIG_FONT_PT", "7"))

STYLE = {
    "font.family": "sans-serif", "font.sans-serif": [FONT, "Arimo", "Liberation Sans", "DejaVu Sans"],
    "font.size": 7, "axes.titlesize": 7, "axes.labelsize": 7, "xtick.labelsize": 6, "ytick.labelsize": 6,
    "legend.fontsize": 6, "legend.title_fontsize": 6,
    "axes.linewidth": 0.5, "xtick.major.width": 0.5, "ytick.major.width": 0.5,
    "xtick.major.size": 2.8, "ytick.major.size": 2.8, "xtick.direction": "out", "ytick.direction": "out",
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": False,
    "axes.facecolor": "white", "figure.facecolor": "white", "savefig.facecolor": "white",
    "axes.edgecolor": INK, "text.color": INK, "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK,
    "axes.prop_cycle": cycler(color=PALETTE), "lines.linewidth": 0.75, "lines.markersize": 2.5,
    "legend.frameon": False, "svg.fonttype": "path", "pdf.fonttype": 42,
    "boxplot.boxprops.linewidth": 0.5, "boxplot.whiskerprops.linewidth": 0.5, "boxplot.capprops.linewidth": 0.5,
    "boxplot.medianprops.linewidth": 0.9, "boxplot.medianprops.color": INK,
}


def use():
    mpl.rcParams.update(STYLE)


def _keep_seaborn_quiet():
    """seaborn.set_theme() resets rcParams; re-apply the style right after it."""
    try:
        import seaborn as sns
    except Exception:
        return
    original = sns.set_theme

    def set_theme(*args, **kwargs):
        original(*args, **kwargs)
        use()
    sns.set_theme = set_theme
    sns.set = set_theme

    # Keep what a box plot was drawn from, so the samples can be shown on top of the boxes at save time.
    original_box = sns.boxplot

    def boxplot(*args, **kwargs):
        ax = original_box(*args, **kwargs)
        data, x, y = kwargs.get("data"), kwargs.get("x"), kwargs.get("y")
        if data is not None and isinstance(x, str) and isinstance(y, str):
            order = [t.get_text() for t in ax.get_xticklabels()] or list(dict.fromkeys(data[x]))
            ax._continual_box = {"groups": [data.loc[data[x] == g, y].dropna().to_numpy() for g in order], "labels": order}
        return ax
    sns.boxplot = boxplot


def _improve(fig):
    notes = []
    from matplotlib.colors import TwoSlopeNorm, LinearSegmentedColormap
    from matplotlib.image import AxesImage
    from matplotlib.patches import PathPatch
    for ax in fig.axes:
        if ax.get_label() == "<colorbar>":
            continue
        title = ax.get_title()
        if title:
            notes.append(f'Title moved to the caption: "{title}"')
            ax.set_title("")
        ax.grid(False)
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        for side in ("left", "bottom"):
            ax.spines[side].set_linewidth(0.5)
            ax.spines[side].set_color(INK)
        ax.set_facecolor("white")
        ax.tick_params(width=0.5, length=2.8, labelsize=6, colors=INK, direction="out")
        ax.xaxis.label.set_size(7)
        ax.yaxis.label.set_size(7)

        # Heatmap: a rainbow map is replaced by a diverging one centred on zero, from the data itself.
        for im in [a for a in ax.get_children() if isinstance(a, AxesImage)]:
            data = im.get_array()
            if im.get_cmap().name in ("jet", "rainbow", "hsv", "turbo", "gist_rainbow", "viridis") and float(data.min()) < 0 < float(data.max()):
                lim = float(max(abs(data.min()), abs(data.max())))
                im.set_cmap(LinearSegmentedColormap.from_list("updown", [DOWN, "#ffffff", UP]))
                im.set_norm(TwoSlopeNorm(vcenter=0, vmin=-lim, vmax=lim))
                notes.append("Rainbow colour map replaced by down / white / up, centred on 0")

        # Correlation: one scatter plus a fitted line. Show r and n from the plotted points, drop the legend.
        from matplotlib.collections import PathCollection
        scatters = [c for c in ax.collections if isinstance(c, PathCollection) and len(c.get_offsets()) >= 5]
        fits = [l for l in ax.get_lines() if len(l.get_xdata()) >= 2]
        if len(scatters) == 1 and len(fits) == 1 and ax.get_legend() is not None:
            import numpy as np
            xy = np.asarray(scatters[0].get_offsets())
            r = float(np.corrcoef(xy[:, 0], xy[:, 1])[0, 1])
            ax.get_legend().remove()
            scatters[0].set_sizes([6]); scatters[0].set_facecolor(INK); scatters[0].set_alpha(0.7); scatters[0].set_linewidth(0)
            fits[0].set_color(GREY); fits[0].set_linewidth(0.75); fits[0].set_label("_fit")
            ax.text(0.03, 0.97, f"r = {r:.2f}, n = {len(xy)}", transform=ax.transAxes, va="top", fontsize=6, color=INK)
            lo = min(ax.get_xlim()[0], ax.get_ylim()[0]); hi = max(ax.get_xlim()[1], ax.get_ylim()[1])
            if "log2" in (ax.get_xlabel() + ax.get_ylabel()):
                ax.plot([lo, hi], [lo, hi], color=NULL, linewidth=0.5, linestyle=(0, (2, 2)), zorder=0, label="_identity")
                ax.set_xlim(lo, hi); ax.set_ylim(lo, hi); ax.set_aspect("equal", adjustable="box")
                notes.append("Both axes are log2 of the same quantity: equal scales and the identity line added")
            notes.append(f"Legend replaced by r = {r:.2f} and n = {len(xy)}, computed from the plotted points")
            for axis in ("x", "y"):
                label = getattr(ax, f"get_{axis}label")()
                if label.startswith("log2 "):
                    getattr(ax, f"set_{axis}label")("log$_2$ " + label[5:])
        # Lines: up to five series get labels at their last point instead of a legend.
        # Seaborn 0.13 adds empty lines as legend handles; only lines with data count.
        lines = [l for l in ax.get_lines() if l.get_label() and not l.get_label().startswith("_") and len(l.get_xdata())]
        legend = ax.get_legend()
        if legend and 0 < len(lines) <= 5:
            legend.remove()
            ends = []
            for i, line in enumerate(lines):
                line.set_color(PALETTE[i % len(PALETTE)])
                line.set_markerfacecolor(PALETTE[i % len(PALETTE)])
                line.set_markersize(2.5)
                line.set_linewidth(0.75)
                x, y = line.get_xdata()[-1], line.get_ydata()[-1]
                ends.append([y, line])
            ends.sort(key=lambda e: e[0])
            span = (ax.get_ylim()[1] - ax.get_ylim()[0]) * 0.06
            for i in range(1, len(ends)):
                if ends[i][0] - ends[i - 1][0] < span:
                    ends[i][0] = ends[i - 1][0] + span
            for y, line in ends:
                ax.annotate(line.get_label(), (line.get_xdata()[-1], y), xytext=(4, 0), textcoords="offset points",
                            va="center", fontsize=6, color=line.get_color(), annotation_clip=False)
            notes.append(f"Legend of {len(lines)} lines replaced by labels at the line ends")

        # Boxes with their data known: redraw narrow neutral boxes and show every sample as a point.
        box = getattr(ax, "_continual_box", None)
        if box:
            import numpy as np
            labels = box["labels"]
            ylabel, xlabel = ax.get_ylabel(), ax.get_xlabel()
            for artist in list(ax.patches) + list(ax.lines) + list(ax.collections):
                artist.remove()
            if ax.get_legend() is not None:
                ax.get_legend().remove()
            positions = np.arange(len(labels))
            ax.boxplot(box["groups"], positions=positions, widths=0.4, patch_artist=True, showfliers=False,
                       boxprops={"facecolor": "#e6e8e5", "edgecolor": INK, "linewidth": 0.5},
                       whiskerprops={"color": INK, "linewidth": 0.5}, capprops={"color": INK, "linewidth": 0.5},
                       medianprops={"color": INK, "linewidth": 0.9})
            rng = np.random.default_rng(0)
            for i, values in enumerate(box["groups"]):
                ax.scatter(i + rng.uniform(-0.09, 0.09, len(values)), values, s=5, color=INK, alpha=0.75, linewidths=0, zorder=3)
            ax.set_xticks(positions, labels)
            ax.set_xlim(-0.6, len(labels) - 0.4)
            ax.set_xlabel(xlabel)
            ax.set_ylabel(ylabel)
            fig._continual_categories = max(getattr(fig, "_continual_categories", 0), len(labels))
            n = sorted({len(g) for g in box["groups"]})
            notes.append(f"Boxes narrowed and the samples shown as points (n = {'–'.join(map(str, n))} per group); outlier circles dropped, the points show them")
            notes.append("The colour repeated the x axis: legend removed, boxes made neutral")
        boxes = [] if box else [p for p in ax.patches if isinstance(p, PathPatch)]
        if boxes:
            for p in boxes:
                p.set_facecolor("#e6e8e5")
                p.set_edgecolor(INK)
                p.set_linewidth(0.5)
            for l in ax.get_lines():
                l.set_color(INK)
                l.set_linewidth(0.5)
            if legend is not None and ax.get_legend() is not None:
                labels = [t.get_text() for t in ax.get_legend().get_texts()]
                ticks = [t.get_text() for t in ax.get_xticklabels()]
                if labels and set(labels) <= set(ticks):
                    ax.get_legend().remove()
                    notes.append("The colour repeated the x axis: legend removed, boxes made neutral")
            notes.append("Boxes hide the samples: suggest showing the points (n = 8 per group)")

        label = ax.get_ylabel()
        unitless = ("RIN", "ratio", "score", "index", "fraction", "PC")
        if label and not any(u in label for u in ("(", "log", "%", "count") + unitless):
            notes.append(f'Axis "{label}" has no unit')
    # Colour bars follow the style too.
    for ax in fig.axes:
        if ax.get_label() == "<colorbar>":
            ax.tick_params(width=0.5, length=2.8, labelsize=6, colors=INK)
            for s in ax.spines.values():
                s.set_linewidth(0.5)
    return notes


def _record(fig, path, notes, width_mm, height_mm):
    from matplotlib.image import AxesImage
    axes = []
    for ax in fig.axes:
        axes.append({
            "role": "colorbar" if ax.get_label() == "<colorbar>" else "plot",
            "xlabel": ax.get_xlabel(), "ylabel": ax.get_ylabel(),
            "lines": [{"label": l.get_label(), "points": len(l.get_xdata())} for l in ax.get_lines() if not l.get_label().startswith("_")],
            "collections": [type(c).__name__ for c in ax.collections],
            "images": [list(a.get_array().shape) for a in ax.get_children() if isinstance(a, AxesImage)],
            "patches": len(ax.patches),
        })
    rec = {"file": os.path.basename(path), "tool": "matplotlib", "script": os.environ.get("CONTINUALFIG_SCRIPT", ""),
           "width_mm": width_mm, "height_mm": height_mm, "axes": axes, "changes": notes}
    base = os.path.splitext(os.path.basename(path))[0]
    with open(os.path.join(RECORDS, base + ".json"), "w") as f:
        json.dump(rec, f, indent=2)


def _patch_savefig():
    from matplotlib.figure import Figure
    original = Figure.savefig

    def savefig(self, fname, *args, **kwargs):
        if MODE == "record":
            w_in, h_in = self.get_size_inches()
            _record(self, str(fname), [], round(w_in * 25.4), round(h_in * 25.4))
            return original(self, fname, *args, **kwargs)
        if not ON:
            return original(self, fname, *args, **kwargs)
        w_in, h_in = self.get_size_inches()
        aspect = min(1.35, h_in / w_in)
        # The smallest width that fits: a categorical plot needs about 16 mm per category.
        categories = getattr(self, "_continual_categories", 0)
        width = min(WIDTH_MM["single"], 18 + 16 * categories) if categories else WIDTH_MM["single"]
        height = round(min(170, WIDTH_MM["single"] * aspect * (0.85 if categories else 1)))
        notes = _improve(self)
        categories = getattr(self, "_continual_categories", 0)
        if categories:
            width = min(WIDTH_MM["single"], 18 + 16 * categories)
            height = round(width * 0.8)
        if WIDTH_OPT:
            new = WIDTH_MM.get(WIDTH_OPT) or float(WIDTH_OPT)
            height, width = round(height * new / width), new
        if FONT_PT != 7:
            for text in self.findobj(lambda a: hasattr(a, "set_fontsize") and hasattr(a, "get_fontsize")):
                try:
                    text.set_fontsize(text.get_fontsize() * FONT_PT / 7)
                except Exception:
                    pass
        self.set_size_inches(width * MM, height * MM)
        self.tight_layout(pad=0.4)
        kwargs.pop("dpi", None)
        _record(self, str(fname), notes, width, height)
        return original(self, fname, *args, **kwargs)
    Figure.savefig = savefig


def install():
    if MODE == "record":
        _patch_savefig()
        return
    if not ON:
        return
    use()
    _patch_savefig()
    # seaborn may be imported later; patch it when it is.
    import builtins
    real_import = builtins.__import__

    def hooked(name, *args, **kwargs):
        module = real_import(name, *args, **kwargs)
        # Only once seaborn has finished importing (it imports itself while loading).
        if name == "seaborn" and hasattr(module, "boxplot") and not getattr(module, "_continual", False):
            module._continual = True
            _keep_seaborn_quiet()
        return module
    builtins.__import__ = hooked
