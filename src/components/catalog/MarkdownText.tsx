"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownTextProps {
  text: string;
  className?: string;
}

/**
 * Рендер markdown-описания (жирный, курсив, списки, заголовки, ссылки, таблицы).
 * Сырой HTML в тексте намеренно не рендерится (встроенная защита react-markdown).
 */
export function MarkdownText({ text, className }: MarkdownTextProps) {
  if (!text) return null;
  return (
    <div className={`markdown-body${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
