import React from 'react';
import { useT } from '../../i18n/LangContext';
import type { FormatTool } from '../../hooks/useMarkdownFormat';

interface MarkdownToolbarProps {
    tools: FormatTool[];
    className?: string;
}

/** Row of formatting buttons. They never take focus from the text field. */
export const MarkdownToolbar: React.FC<MarkdownToolbarProps> = ({
    tools,
    className = '',
}) => {
    const { t } = useT();
    return (
        <div
            className={`md-toolbar ${className}`.trim()}
            role="toolbar"
            aria-label={t('card.format.aria')}
        >
            {tools.map((tool) => (
                <button
                    key={tool.id}
                    type="button"
                    className="md-toolbar-btn"
                    data-testid={`card-format-${tool.id}`}
                    title={
                        tool.shortcut
                            ? `${tool.label} (Ctrl+${tool.shortcut})`
                            : tool.label
                    }
                    aria-label={tool.label}
                    // Keep the caret and selection in the text field.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={tool.run}
                >
                    {tool.icon}
                </button>
            ))}
        </div>
    );
};
