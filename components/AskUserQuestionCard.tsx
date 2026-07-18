"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AgentQuestionForm, QuestionAnswers } from "@/lib/types";

type Props = {
  form: AgentQuestionForm;
  disabled?: boolean;
  onSubmit: (answers: QuestionAnswers) => void;
};

export default function AskUserQuestionCard({ form, disabled, onSubmit }: Props) {
  const [answers, setAnswers] = useState<QuestionAnswers>(form.answers || {});
  const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const questionLabels = useMemo(
    () => new Map(form.questions.map((question) => [question.id, question.label])),
    [form.questions],
  );

  function toggleMulti(questionId: string, value: string) {
    const current = Array.isArray(answers[questionId]) ? answers[questionId] as string[] : [];
    setAnswers({
      ...answers,
      [questionId]: current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const finalAnswers: QuestionAnswers = {};

    for (const question of form.questions) {
      const value = answers[question.id];
      const isOtherSelected = Array.isArray(value) ? value.includes("__other__") : value === "__other__";
      const otherValue = otherAnswers[question.id]?.trim();
      const empty = Array.isArray(value) ? value.length === 0 : !String(value || "").trim();
      if (question.required !== false && (empty || (isOtherSelected && !otherValue))) {
        setError(`请补充「${question.label}」，也可以选择“不确定”。`);
        return;
      }
      if (Array.isArray(value)) {
        const optionLabels = new Map((question.options || []).map((option) => [option.value, option.label]));
        finalAnswers[question.id] = value
          .map((item) => item === "__other__" ? otherValue : optionLabels.get(item) || item)
          .filter(Boolean);
      } else if (value === "__other__") {
        finalAnswers[question.id] = otherValue || "";
      } else if (value) {
        finalAnswers[question.id] = question.options?.find((option) => option.value === value)?.label || value;
      }
    }

    setError("");
    onSubmit(finalAnswers);
  }

  if (form.status === "submitted") {
    return (
      <div className="question-form-card submitted" aria-label="已提交的补充信息">
        <div className="question-form-head">
          <span>QUICK ANSWER / 已补充</span>
          <span className="status-pill active">已提交</span>
        </div>
        <div className="submitted-answers">
          {Object.entries(form.answers || {}).map(([id, value]) => (
            <div key={id}>
              <span>{questionLabels.get(id) || id}</span>
              <strong>{Array.isArray(value) ? value.join("、") : value}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form className="question-form-card" onSubmit={submit}>
      <div className="question-form-head">
        <span>QUICK ANSWER / 快速补充</span>
        <span>{form.questions.length} 个小问题</span>
      </div>
      <h3>{form.title}</h3>
      {form.description && <p className="question-form-description">{form.description}</p>}

      <div className="question-list">
        {form.questions.map((question, index) => {
          const value = answers[question.id];
          const options = question.options || [];
          return (
            <fieldset key={question.id}>
              <legend><span>{String(index + 1).padStart(2, "0")}</span>{question.label}</legend>

              {question.type === "short_text" ? (
                <input
                  className="question-text-input"
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
                  placeholder={question.placeholder || "简单说一句就好"}
                  disabled={disabled}
                />
              ) : (
                <div className="question-options">
                  {options.map((option) => {
                    const selected = Array.isArray(value) ? value.includes(option.value) : value === option.value;
                    return (
                      <label key={option.value} className={selected ? "selected" : ""}>
                        <input
                          type={question.type === "multi_choice" ? "checkbox" : "radio"}
                          name={question.id}
                          value={option.value}
                          checked={selected}
                          disabled={disabled}
                          onChange={() => question.type === "multi_choice"
                            ? toggleMulti(question.id, option.value)
                            : setAnswers({ ...answers, [question.id]: option.value })}
                        />
                        <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                      </label>
                    );
                  })}
                  {question.allowOther && (
                    <label className={(Array.isArray(value) ? value.includes("__other__") : value === "__other__") ? "selected" : ""}>
                      <input
                        type={question.type === "multi_choice" ? "checkbox" : "radio"}
                        name={question.id}
                        value="__other__"
                        checked={Array.isArray(value) ? value.includes("__other__") : value === "__other__"}
                        disabled={disabled}
                        onChange={() => question.type === "multi_choice"
                          ? toggleMulti(question.id, "__other__")
                          : setAnswers({ ...answers, [question.id]: "__other__" })}
                      />
                      <span><strong>其他</strong><small>按自己的说法补充</small></span>
                    </label>
                  )}
                </div>
              )}

              {(Array.isArray(value) ? value.includes("__other__") : value === "__other__") && (
                <input
                  className="question-text-input other-input"
                  value={otherAnswers[question.id] || ""}
                  onChange={(event) => setOtherAnswers({ ...otherAnswers, [question.id]: event.target.value })}
                  placeholder="用一句话补充"
                  disabled={disabled}
                  autoFocus
                />
              )}
            </fieldset>
          );
        })}
      </div>

      {error && <p className="question-form-error" role="alert">{error}</p>}
      <div className="question-form-footer">
        <span>没有标准答案，选最接近的就好。</span>
        <button type="submit" className="highlight-button" disabled={disabled}>
          {disabled ? "正在整理" : form.submitLabel || "补充好了"}
        </button>
      </div>
    </form>
  );
}
