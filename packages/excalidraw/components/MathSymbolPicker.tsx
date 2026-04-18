import clsx from "clsx";
import { useState } from "react";

import {
  getBoundTextElement,
  isTextElement,
  redrawTextBoundingBox,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { t } from "../i18n";

import type { AppClassProperties, UIAppState } from "../types";

import "./MathSymbolPicker.scss";

type CategoryKey =
  | "greek"
  | "operators"
  | "relations"
  | "sets"
  | "calculus"
  | "arrows"
  | "scripts"
  | "fractions";

type Category = {
  key: CategoryKey;
  labelKey: Parameters<typeof t>[0];
  symbols: { char: string; title: string }[];
};

// Unicode math symbols. Keep labels short — used as hover tooltips.
const CATEGORIES: Category[] = [
  {
    key: "greek",
    labelKey: "labels.mathSymbols_greek",
    symbols: [
      { char: "α", title: "alpha" },
      { char: "β", title: "beta" },
      { char: "γ", title: "gamma" },
      { char: "δ", title: "delta" },
      { char: "ε", title: "epsilon" },
      { char: "ζ", title: "zeta" },
      { char: "η", title: "eta" },
      { char: "θ", title: "theta" },
      { char: "ι", title: "iota" },
      { char: "κ", title: "kappa" },
      { char: "λ", title: "lambda" },
      { char: "μ", title: "mu" },
      { char: "ν", title: "nu" },
      { char: "ξ", title: "xi" },
      { char: "π", title: "pi" },
      { char: "ρ", title: "rho" },
      { char: "σ", title: "sigma" },
      { char: "τ", title: "tau" },
      { char: "υ", title: "upsilon" },
      { char: "φ", title: "phi" },
      { char: "χ", title: "chi" },
      { char: "ψ", title: "psi" },
      { char: "ω", title: "omega" },
      { char: "Γ", title: "Gamma" },
      { char: "Δ", title: "Delta" },
      { char: "Θ", title: "Theta" },
      { char: "Λ", title: "Lambda" },
      { char: "Ξ", title: "Xi" },
      { char: "Π", title: "Pi" },
      { char: "Σ", title: "Sigma" },
      { char: "Φ", title: "Phi" },
      { char: "Ψ", title: "Psi" },
      { char: "Ω", title: "Omega" },
    ],
  },
  {
    key: "operators",
    labelKey: "labels.mathSymbols_operators",
    symbols: [
      { char: "±", title: "plus-minus" },
      { char: "∓", title: "minus-plus" },
      { char: "×", title: "times" },
      { char: "÷", title: "divide" },
      { char: "·", title: "dot" },
      { char: "∘", title: "ring" },
      { char: "√", title: "square root" },
      { char: "∛", title: "cube root" },
      { char: "∜", title: "fourth root" },
      { char: "∑", title: "sum" },
      { char: "∏", title: "product" },
      { char: "∐", title: "coproduct" },
      { char: "⊕", title: "direct sum" },
      { char: "⊗", title: "tensor product" },
      { char: "∗", title: "asterisk" },
      { char: "⋅", title: "dot operator" },
    ],
  },
  {
    key: "relations",
    labelKey: "labels.mathSymbols_relations",
    symbols: [
      { char: "=", title: "equals" },
      { char: "≠", title: "not equal" },
      { char: "≈", title: "approx" },
      { char: "≡", title: "identical" },
      { char: "≅", title: "congruent" },
      { char: "≜", title: "defined as" },
      { char: "≤", title: "less or equal" },
      { char: "≥", title: "greater or equal" },
      { char: "≪", title: "much less" },
      { char: "≫", title: "much greater" },
      { char: "∝", title: "proportional" },
      { char: "∼", title: "similar" },
      { char: "≺", title: "precedes" },
      { char: "≻", title: "succeeds" },
    ],
  },
  {
    key: "sets",
    labelKey: "labels.mathSymbols_sets",
    symbols: [
      { char: "∈", title: "element of" },
      { char: "∉", title: "not element of" },
      { char: "∋", title: "contains" },
      { char: "⊂", title: "subset" },
      { char: "⊃", title: "superset" },
      { char: "⊆", title: "subset or equal" },
      { char: "⊇", title: "superset or equal" },
      { char: "∪", title: "union" },
      { char: "∩", title: "intersection" },
      { char: "∅", title: "empty set" },
      { char: "∀", title: "for all" },
      { char: "∃", title: "exists" },
      { char: "∄", title: "does not exist" },
      { char: "∧", title: "logical and" },
      { char: "∨", title: "logical or" },
      { char: "¬", title: "not" },
      { char: "⊥", title: "perpendicular / bottom" },
      { char: "⊤", title: "top" },
      { char: "ℝ", title: "reals" },
      { char: "ℤ", title: "integers" },
      { char: "ℕ", title: "naturals" },
      { char: "ℚ", title: "rationals" },
      { char: "ℂ", title: "complex" },
    ],
  },
  {
    key: "calculus",
    labelKey: "labels.mathSymbols_calculus",
    symbols: [
      { char: "∂", title: "partial derivative" },
      { char: "∇", title: "nabla / del" },
      { char: "∫", title: "integral" },
      { char: "∬", title: "double integral" },
      { char: "∭", title: "triple integral" },
      { char: "∮", title: "contour integral" },
      { char: "∯", title: "surface integral" },
      { char: "∰", title: "volume integral" },
      { char: "∞", title: "infinity" },
      { char: "′", title: "prime" },
      { char: "″", title: "double prime" },
      { char: "‴", title: "triple prime" },
      { char: "Δ", title: "change / Delta" },
      { char: "ℓ", title: "script l" },
      { char: "ℏ", title: "h-bar" },
    ],
  },
  {
    key: "arrows",
    labelKey: "labels.mathSymbols_arrows",
    symbols: [
      { char: "→", title: "right arrow" },
      { char: "←", title: "left arrow" },
      { char: "↑", title: "up arrow" },
      { char: "↓", title: "down arrow" },
      { char: "↔", title: "left-right arrow" },
      { char: "⇒", title: "implies" },
      { char: "⇐", title: "is implied by" },
      { char: "⇔", title: "iff" },
      { char: "↦", title: "maps to" },
      { char: "⟶", title: "long right arrow" },
      { char: "⟵", title: "long left arrow" },
      { char: "⟹", title: "long implies" },
      { char: "⟺", title: "long iff" },
      { char: "∴", title: "therefore" },
      { char: "∵", title: "because" },
    ],
  },
  {
    key: "scripts",
    labelKey: "labels.mathSymbols_scripts",
    symbols: [
      { char: "⁰", title: "superscript 0" },
      { char: "¹", title: "superscript 1" },
      { char: "²", title: "superscript 2" },
      { char: "³", title: "superscript 3" },
      { char: "⁴", title: "superscript 4" },
      { char: "⁵", title: "superscript 5" },
      { char: "⁶", title: "superscript 6" },
      { char: "⁷", title: "superscript 7" },
      { char: "⁸", title: "superscript 8" },
      { char: "⁹", title: "superscript 9" },
      { char: "⁺", title: "superscript +" },
      { char: "⁻", title: "superscript -" },
      { char: "⁼", title: "superscript =" },
      { char: "ⁿ", title: "superscript n" },
      { char: "₀", title: "subscript 0" },
      { char: "₁", title: "subscript 1" },
      { char: "₂", title: "subscript 2" },
      { char: "₃", title: "subscript 3" },
      { char: "₄", title: "subscript 4" },
      { char: "₅", title: "subscript 5" },
      { char: "₆", title: "subscript 6" },
      { char: "₇", title: "subscript 7" },
      { char: "₈", title: "subscript 8" },
      { char: "₉", title: "subscript 9" },
      { char: "₊", title: "subscript +" },
      { char: "₋", title: "subscript -" },
      { char: "ₓ", title: "subscript x" },
      { char: "ᵢ", title: "subscript i" },
      { char: "ⱼ", title: "subscript j" },
      { char: "ₙ", title: "subscript n" },
    ],
  },
  {
    key: "fractions",
    labelKey: "labels.mathSymbols_fractions",
    symbols: [
      { char: "½", title: "1/2" },
      { char: "⅓", title: "1/3" },
      { char: "⅔", title: "2/3" },
      { char: "¼", title: "1/4" },
      { char: "¾", title: "3/4" },
      { char: "⅕", title: "1/5" },
      { char: "⅖", title: "2/5" },
      { char: "⅗", title: "3/5" },
      { char: "⅘", title: "4/5" },
      { char: "⅙", title: "1/6" },
      { char: "⅚", title: "5/6" },
      { char: "⅛", title: "1/8" },
      { char: "⅜", title: "3/8" },
      { char: "⅝", title: "5/8" },
      { char: "⅞", title: "7/8" },
      { char: "⁄", title: "fraction slash (a⁄b)" },
    ],
  },
];

/**
 * Insert a symbol. If the wysiwyg text editor is active, drop the symbol at
 * the caret and let the editor's normal input pipeline handle the update.
 * Otherwise, append the symbol to each selected text element.
 */
const insertMathSymbol = (
  symbol: string,
  app: AppClassProperties,
  appState: UIAppState,
  targetElements: ExcalidrawElement[],
) => {
  if (appState.editingTextElement) {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "textarea.excalidraw-wysiwyg",
    );
    if (textarea) {
      const value = textarea.value;
      const start = textarea.selectionStart ?? value.length;
      const end = textarea.selectionEnd ?? value.length;
      textarea.value = value.slice(0, start) + symbol + value.slice(end);
      const newPos = start + symbol.length;
      textarea.selectionStart = textarea.selectionEnd = newPos;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
      return;
    }
  }

  const elementsMap = app.scene.getNonDeletedElementsMap();
  targetElements.forEach((el) => {
    if (isTextElement(el)) {
      const newText = el.text + symbol;
      app.scene.mutateElement(el, {
        text: newText,
        originalText: newText,
      });
      redrawTextBoundingBox(el, app.scene.getContainerElement(el), app.scene);
      return;
    }
    const bound = getBoundTextElement(el, elementsMap);
    if (bound) {
      const newText = bound.text + symbol;
      app.scene.mutateElement(bound, {
        text: newText,
        originalText: newText,
      });
      redrawTextBoundingBox(bound, el, app.scene);
    }
  });
};

export const MathSymbolPickerContent = ({
  app,
  appState,
  targetElements,
}: {
  app: AppClassProperties;
  appState: UIAppState;
  targetElements: ExcalidrawElement[];
}) => {
  const [activeCategory, setActiveCategory] = useState<CategoryKey>("greek");
  const category =
    CATEGORIES.find((c) => c.key === activeCategory) ?? CATEGORIES[0];

  return (
    <div className="math-symbol-picker">
      <div className="math-symbol-picker__title">{t("labels.mathSymbols")}</div>
      <div
        className="math-symbol-picker__tabs"
        role="tablist"
        aria-label={t("labels.mathSymbols")}
      >
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={c.key === activeCategory}
            className={clsx("math-symbol-picker__tab", {
              active: c.key === activeCategory,
            })}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveCategory(c.key);
            }}
            // prevent stealing focus from the text editor
            onMouseDown={(e) => e.preventDefault()}
          >
            {t(c.labelKey)}
          </button>
        ))}
      </div>
      <div className="math-symbol-picker__grid" role="tabpanel">
        {category.symbols.map((sym) => (
          <button
            key={`${category.key}-${sym.char}`}
            type="button"
            className="math-symbol-picker__symbol"
            title={`${sym.char} — ${sym.title}`}
            aria-label={sym.title}
            // prevent stealing focus from the text editor so caret survives
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              insertMathSymbol(sym.char, app, appState, targetElements);
            }}
          >
            {sym.char}
          </button>
        ))}
      </div>
    </div>
  );
};
