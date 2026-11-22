// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Installer/HaloProgress.cs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

using System;
using System.ComponentModel;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;

internal sealed class HaloProgress : FrameworkElement
{
    private static readonly DependencyProperty PercentProperty = DependencyProperty.Register(
        "Percent", typeof(double), typeof(HaloProgress),
        new FrameworkPropertyMetadata(0.0, FrameworkPropertyMetadataOptions.AffectsRender, UpdateNumber));

    private static readonly DependencyProperty OrbitProperty = DependencyProperty.Register(
        "Orbit", typeof(double), typeof(HaloProgress),
        new FrameworkPropertyMetadata(0.0, FrameworkPropertyMetadataOptions.AffectsRender));

    private static readonly Pen Track = Light(255, 54, 66, 70, 1.8);
    private static readonly Pen IdleTrack = Light(255, 196, 219, 219, 2.7);
    private static readonly Pen BloomFar = Light(8, 169, 225, 226, 10);
    private static readonly Pen BloomNear = Light(36, 169, 225, 226, 5);
    private static readonly Pen Edge = Light(255, 227, 251, 250, 2.7);
    private static readonly RadialGradientBrush TipGlow = CreateTipGlow();
    private readonly TextBlock counter;
    private bool working, pending, spinning;
    private int displayed = -1;
    private double target;

    internal HaloProgress(TextBlock counter)
    {
        this.counter = counter;
        IsHitTestVisible = false;
        SetNumber(0);
    }

    private static Pen Light(byte alpha, byte red, byte green, byte blue, double thickness)
    {
        var pen = new Pen(new SolidColorBrush(Color.FromArgb(alpha, red, green, blue)), thickness)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round
        };
        pen.Freeze();
        return pen;
    }

    private static RadialGradientBrush CreateTipGlow()
    {
        var glow = new RadialGradientBrush();
        glow.GradientStops.Add(new GradientStop(Color.FromArgb(156, 211, 250, 247), 0));
        glow.GradientStops.Add(new GradientStop(Color.FromArgb(40, 163, 231, 226), .35));
        glow.GradientStops.Add(new GradientStop(Color.FromArgb(0, 163, 231, 226), 1));
        glow.Freeze();
        return glow;
    }

    internal void Reset()
    {
        working = pending = false;
        target = 0;
        BeginAnimation(PercentProperty, null);
        SetValue(PercentProperty, 0.0);
        ChangeWindowVisibility(false);
        InvalidateVisual();
    }

    internal void ShowProgress(double percent, bool waiting, bool visible)
    {
        working = true;
        pending = waiting;
        if (percent != target)
        {
            var previous = (double)GetValue(PercentProperty);
            target = percent;
            SetValue(PercentProperty, percent);
            if (SystemParameters.ClientAreaAnimation && visible)
            {
                BeginAnimation(PercentProperty, new DoubleAnimation(previous, percent, TimeSpan.FromMilliseconds(220))
                {
                    EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut },
                    FillBehavior = FillBehavior.Stop
                });
            }
            else
            {
                BeginAnimation(PercentProperty, null);
            }
        }
        ChangeWindowVisibility(visible);
        InvalidateVisual();
    }

    internal void ChangeWindowVisibility(bool visible)
    {
        var active = pending && visible && SystemParameters.ClientAreaAnimation;
        if (active == spinning) return;
        spinning = active;
        if (!active)
        {
            BeginAnimation(OrbitProperty, null);
            return;
        }
        BeginAnimation(OrbitProperty, new DoubleAnimation(0, 360, TimeSpan.FromSeconds(1.55))
        {
            RepeatBehavior = RepeatBehavior.Forever
        });
    }

    private static void UpdateNumber(DependencyObject sender, DependencyPropertyChangedEventArgs args)
    {
        ((HaloProgress)sender).SetNumber((int)Math.Floor((double)args.NewValue));
    }

    private void SetNumber(int value)
    {
        if (displayed == value) return;
        displayed = value;
        counter.Text = value.ToString(CultureInfo.InvariantCulture) + "%";
    }

    protected override void OnRender(DrawingContext drawing)
    {
        var center = new Point(RenderSize.Width / 2, RenderSize.Height / 2);
        var radius = Math.Min(center.X, center.Y) - 21;
        if (radius <= 0) return;
        if (!working) drawing.DrawEllipse(null, BloomNear, center, radius, radius);
        drawing.DrawEllipse(null, working ? Track : IdleTrack, center, radius, radius);
        if (!working) return;

        double start = -90;
        double sweep = (double)GetValue(PercentProperty) * 3.6;
        if (pending)
        {
            start += (double)GetValue(OrbitProperty);
            sweep = 48;
        }
        if (sweep >= 360)
        {
            drawing.DrawEllipse(null, BloomFar, center, radius, radius);
            drawing.DrawEllipse(null, BloomNear, center, radius, radius);
            drawing.DrawEllipse(null, Edge, center, radius, radius);
            return;
        }
        if (sweep <= .05) return;

        var tip = PointAt(center, radius, start + sweep);
        var arc = new StreamGeometry();
        using (var geometry = arc.Open())
        {
            geometry.BeginFigure(PointAt(center, radius, start), false, false);
            geometry.ArcTo(tip, new Size(radius, radius),
                           0, sweep > 180, SweepDirection.Clockwise, true, false);
        }
        drawing.DrawGeometry(null, BloomFar, arc);
        drawing.DrawGeometry(null, BloomNear, arc);
        drawing.DrawGeometry(null, Edge, arc);
        drawing.DrawEllipse(TipGlow, null, tip, 7, 7);
    }

    private static Point PointAt(Point center, double radius, double degrees)
    {
        var radians = degrees * Math.PI / 180;
        return new Point(center.X + radius * Math.Cos(radians), center.Y + radius * Math.Sin(radians));
    }
}

internal sealed class OutlinedLabel : FrameworkElement
{
    private readonly TextBlock label;
    private readonly Pen stroke;

    internal OutlinedLabel(TextBlock label, double strokeWidth)
    {
        this.label = label;
        stroke = new Pen(Brushes.Black, strokeWidth) { LineJoin = PenLineJoin.Round };
        stroke.Freeze();
        IsHitTestVisible = false;
        Effect = new DropShadowEffect { Color = Colors.Black, BlurRadius = 6, ShadowDepth = 1, Opacity = .8 };
        label.Opacity = 0;
        DependencyPropertyDescriptor.FromProperty(TextBlock.TextProperty, typeof(TextBlock))
            .AddValueChanged(label, delegate { InvalidateVisual(); });
        label.SizeChanged += delegate { InvalidateVisual(); };
    }

    protected override void OnRender(DrawingContext drawing)
    {
        if (String.IsNullOrEmpty(label.Text) || label.ActualWidth <= 0) return;
        var typeface = new Typeface(label.FontFamily, label.FontStyle, label.FontWeight, label.FontStretch);
        var text = new FormattedText(label.Text, CultureInfo.CurrentUICulture, label.FlowDirection,
            typeface, label.FontSize, label.Foreground, VisualTreeHelper.GetDpi(this).PixelsPerDip)
        {
            TextAlignment = label.TextAlignment,
            MaxTextWidth = label.ActualWidth + .5
        };
        var origin = label.TranslatePoint(new Point(0, 0), this);
        var shape = text.BuildGeometry(origin);
        drawing.DrawGeometry(null, stroke, shape);
        drawing.DrawGeometry(label.Foreground, null, shape);
    }
}
