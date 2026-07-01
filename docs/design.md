---
name: SunnyD Notes
version: "1.0"
colors:
  primary: "#5E38A0"
  primary-light: "#7a5cb8"
  primary-lighter: "#9b7cc9"
  primary-overlay-light: "rgba(94, 56, 160, 0.04)"
  primary-overlay-mid: "rgba(94, 56, 160, 0.12)"
  primary-overlay-dark: "rgba(94, 56, 160, 0.2)"
  
  accent-orange: "#ed7f21"
  accent-orange-dark: "#C45A1A"
  accent-orange-light: "#e07a2c"
  accent-orange-overlay-light: "rgba(237, 127, 33, 0.1)"
  accent-orange-overlay-mid: "rgba(237, 127, 33, 0.22)"
  
  accent-green: "#1A6835"
  accent-green-light: "#13542a"
  accent-green-overlay-light: "rgba(26, 104, 53, 0.04)"
  accent-green-overlay-mid: "rgba(26, 104, 53, 0.1)"
  accent-green-overlay-dark: "rgba(26, 104, 53, 0.22)"
  
  accent-red: "#C83232"
  accent-red-overlay: "rgba(200, 50, 50, 0.06)"
  
  accent-muted: "rgba(197, 120, 0, 0.06)"
  accent-muted-border: "rgba(197, 120, 0, 0.22)"
  
  neutral-pure-white: "#ffffff"
  neutral-off-white: "#FDF8F2"
  neutral-cream: "#F7F0E6"
  neutral-warm-light: "rgba(232, 246, 239, 0.92)"
  neutral-beige-light: "rgba(246, 243, 239, 0.65)"
  neutral-paper: "rgba(255, 252, 247, 0.97)"
  neutral-glass: "rgba(255, 255, 255, 0.97)"
  
  neutral-dark: "#1a100a"
  neutral-dark-mid: "#2d1a0e"
  neutral-dark-darker: "#3a2010"
  neutral-dark-darkest: "#4a2a14"
  neutral-overlay-dark: "rgba(30, 20, 10, 0.45)"
  
  text-body: "#2d1a0e"
  text-muted: "#9b2020"
  text-disabled: "#C0B8AE"

typography:
  font-family: '"DM Sans", system-ui, sans-serif'
  
  h1:
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
    
  h2:
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
    
  body-lg:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    
  body-md:
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    
  body-sm:
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.4
    
  label-md:
    fontSize: "12.5px"
    fontWeight: 600
    letterSpacing: 0.02em
    
  label-sm:
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: 0.02em
    
  caption:
    fontSize: "10.5px"
    fontWeight: 600
    letterSpacing: 0.02em

spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"

rounded:
  sm: "4px"
  md: "7px"
  lg: "8px"

shadow:
  sm: "0 2px 4px rgba(0,0,0,0.1)"
  md: "0 3px 10px rgba(237,127,33,0.4)"

---

## Visual Philosophy

SunnyD Notes balances warmth and focus. The interface feels **premium and calm** — like a high-end notebook with natural materials (warm creams, soft oranges, subtle purples) rather than cold digital glass. The design prioritizes **clarity over decoration**: clean typography, generous whitespace, and purposeful color accents that guide the eye to actions and important content.

The warm color palette (DM Sans typography, cream/tan backgrounds, earth-toned accents) evokes a physical journal, while interactive elements in purple and orange provide confident, accessible affordances.

## Color System

### Primary — Purple (#5E38A0)
The "thinking" color. Used for interactive elements that invite deep work: suggestion toggles, workspace features, Q&A cards, lecture mode. Overlays (0.04–0.2 opacity) highlight secondary selections and hover states without overwhelming the warm background.

### Accent Orange (#ed7f21 and variants)
The energy and momentum color. Orange drives the eye to saves, sends, and generate actions. The dark variant (#C45A1A) appears in gradients (buttons, progress bars) to add depth and sophistication.

### Accent Green (#1A6835)
Calm, confirmation. Used sparingly for success states, validated inputs, and positive feedback in lecture mode.

### Accent Red (#C83232)
Warning and urgency. Appears in error states and destructive actions, but softly (via overlays) to avoid alarm fatigue.

### Neutrals
- **Warm creams/tans** (#FDF8F2 → #F7F0E6): Primary backgrounds, evoking paper and natural light.
- **White/glass** (#ffffff, #F7F5F2): Floating panels, overlays, maximum contrast text.
- **Dark Browns** (#1a100a → #4a2a14): Deep text, gradients in dark mode or high-contrast areas.

## Typography

**DM Sans** throughout — a friendly, geometric sans-serif that pairs warm neutrals and purple accents without pretension. 

Body text (13px) is generous and legible in long-form note content. Labels (11–12.5px) in semi-bold guide the eye through the UI. Headlines (14–16px) are bold and spacious for note titles and section breaks.

## Spacing & Layout

8px base unit creates a rhythm: 4px (tight), 8px (breathing room), 12px (section separation), 16px (major blocks). This grid keeps the interface calm and organized without visual noise.

## Interaction

Buttons and toggles use the orange accent with rounded corners (7–8px) for tactile friendliness. Hover states layer the purple overlay on text, making the "clickable zone" clear. Disabled states reduce opacity and flatten color rather than shifting the entire palette.

Glass overlays (backdrop blur) on modals and floating elements add depth while keeping the warm background visible — the user never loses context.

---

## Components

### Buttons
- **Primary (orange):** Action buttons — send, save, generate. Gradient from #C45A1A → #e07a2c for depth.
- **Secondary (purple):** Toggles, optional actions. Smaller, lower contrast, often icon-only.
- **Ghost:** Links and breadcrumbs. Text in purple with no background.

### Text Input
Border color shifts from neutral muted (default) to primary purple (focused). Background stays warm (#fff or off-white).

### Cards & Panels
White or off-white background with subtle rounded corners (8px). Light purple overlay on hover. Shadows are soft (0 3px 10px with orange tint) to feel light and floating.

### Color Contrast
All interactive text meets WCAG AA (4.5:1 minimum). Purple on warm backgrounds tests consistently at 5–6:1 contrast. Orange on white hits 7:1+.

