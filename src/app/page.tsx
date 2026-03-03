'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import * as Diff from 'diff';
import { Copy, Trash2, Github, Check, Zap, Layers } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Utility for Tailwind class merging */
function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

const RED_CHUNK_CLASS = 'inline bg-red-100 text-red-700 line-through decoration-red-300 opacity-30 cursor-default';
const GREEN_CHUNK_CLASS = 'inline bg-green-100 text-green-800';

const saveCaretOffset = (root: HTMLElement): number | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;

    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(root);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
};

const countEditableChars = (node: Node): number => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return 0;
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type === 'removed') return 0;

    let total = 0;
    node.childNodes.forEach((child) => {
        total += countEditableChars(child);
    });
    return total;
};

const saveEditableCaretOffset = (root: HTMLElement): number | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;

    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(root);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    const fragment = preCaretRange.cloneContents();
    return countEditableChars(fragment);
};

const restoreEditableCaretOffset = (root: HTMLElement, offset: number | null) => {
    if (offset === null) return;
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    let charCount = 0;
    let targetNode: Node | null = null;
    let targetOffset = 0;
    let lastEditableTextNode: Node | null = null;

    const walk = (node: Node) => {
        if (targetNode) return;

        if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type === 'removed') {
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            const textLength = node.textContent?.length || 0;
            if (textLength > 0) lastEditableTextNode = node;
            const nextCount = charCount + textLength;
            if (offset <= nextCount) {
                targetNode = node;
                targetOffset = Math.max(0, offset - charCount);
                return;
            }
            charCount = nextCount;
            return;
        }

        node.childNodes.forEach(walk);
    };

    walk(root);

    if (targetNode) {
        range.setStart(targetNode, targetOffset);
        range.collapse(true);
    } else if (lastEditableTextNode) {
        range.setStart(lastEditableTextNode, lastEditableTextNode.textContent?.length || 0);
        range.collapse(true);
    } else {
        range.selectNodeContents(root);
        range.collapse(false);
    }

    selection.removeAllRanges();
    selection.addRange(range);
};

const selectionTouchesRemovedChunk = (root: HTMLElement): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return false;

    const removedSpans = Array.from(root.querySelectorAll('span[data-type="removed"]')) as HTMLElement[];
    return removedSpans.some((span) => {
        try {
            return range.intersectsNode(span);
        } catch {
            return false;
        }
    });
};

const doesDeletionTargetRemovedChunk = (root: HTMLElement, direction: 'forward' | 'backward'): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed || !root.contains(range.commonAncestorContainer)) return false;

    const caretOffset = saveCaretOffset(root);
    if (caretOffset === null) return false;

    const targetOffset = direction === 'forward' ? caretOffset : caretOffset - 1;
    if (targetOffset < 0) return false;

    let cursor = 0;
    for (const node of Array.from(root.childNodes)) {
        const textLength = node.textContent?.length || 0;
        const start = cursor;
        const end = cursor + textLength;

        if (targetOffset >= start && targetOffset < end) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const type = (node as HTMLElement).dataset.type;
                return type === 'removed';
            }
            return false;
        }

        cursor = end;
    }

    return false;
};

// --- Components ---

const Button = React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
        variant?: 'default' | 'outline' | 'ghost';
        size?: 'default' | 'sm' | 'icon';
    }
>(({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const variants = {
        default: 'bg-slate-900 text-slate-50 hover:bg-slate-900/90 shadow',
        outline: 'border border-slate-200 bg-white hover:bg-slate-100 text-slate-900 shadow-sm',
        ghost: 'hover:bg-slate-100 text-slate-900',
    };
    const sizes = {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        icon: 'h-9 w-9',
    };
    return (
        <button
            ref={ref}
            className={cn(
                'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:pointer-events-none disabled:opacity-50',
                variants[variant],
                sizes[size],
                className,
            )}
            {...props}
        />
    );
});
Button.displayName = 'Button';

const Textarea = React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }
>(({ className, label, ...props }, ref) => (
    <div className='space-y-2 flex-1'>
        <label className='text-[10px] font-bold uppercase tracking-widest text-slate-400'>{label}</label>
        <textarea
            className={cn(
                'flex min-h-[240px] w-full border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs shadow-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 font-mono transition-all focus:bg-white',
                className,
            )}
            ref={ref}
            {...props}
        />
    </div>
));
Textarea.displayName = 'Textarea';

// --- Main App ---

export default function DiffMeisterSync() {
    const [original, setOriginal] = useState('The quick brown fox jumps over the lazy dog.');
    const [modified, setModified] = useState('The fast brown fox leaps over a lazy cat.');
    const [isHydrated, setIsHydrated] = useState(false);
    const [copied, setCopied] = useState(false);
    const [isCanvasFocused, setIsCanvasFocused] = useState(false);

    const canvasRef = useRef<HTMLDivElement>(null);
    const isSyncing = useRef(false);

    useEffect(() => setIsHydrated(true), []);

    const diffHtml = useMemo(() => {
        const diff = Diff.diffChars(original, modified);
        return diff
            .map((part) => {
                const type = part.added ? 'added' : part.removed ? 'removed' : 'neutral';
                const colorClass = part.added
                    ? 'bg-green-100 text-green-800'
                    : part.removed
                      ? 'bg-red-100 text-red-700 line-through decoration-red-300 opacity-30 cursor-default'
                      : 'text-slate-600';
                const baseText = encodeURIComponent(part.value);
                const readOnlyAttr = type === 'removed' ? 'contenteditable="false"' : '';
                return `<span data-type="${type}" data-base="${baseText}" ${readOnlyAttr} class="inline ${colorClass}">${part.value}</span>`;
            })
            .join('');
    }, [original, modified]);

    useEffect(() => {
        if (!isHydrated || !canvasRef.current) return;
        if (isCanvasFocused) {
            const caretOffset = saveEditableCaretOffset(canvasRef.current);
            canvasRef.current.innerHTML = diffHtml;
            restoreEditableCaretOffset(canvasRef.current, caretOffset);
            return;
        }
        canvasRef.current.innerHTML = diffHtml;
    }, [diffHtml, isHydrated, isCanvasFocused]);

    const handleCanvasInput = useCallback(() => {
        if (!canvasRef.current) return;
        isSyncing.current = true;
        const caretOffset = saveEditableCaretOffset(canvasRef.current);
        let didRewriteRemovedSpan = false;

        const removedSpans = Array.from(
            canvasRef.current.querySelectorAll('span[data-type="removed"]'),
        ) as HTMLElement[];

        removedSpans.forEach((el) => {
            const base = decodeURIComponent(el.dataset.base || '');
            const text = el.textContent || '';
            if (text === base) return;
            didRewriteRemovedSpan = true;

            const charDiff = Diff.diffChars(base, text);
            const fragment = document.createDocumentFragment();

            charDiff.forEach((part) => {
                if (!part.value) return;

                if (part.added) {
                    const addedSpan = document.createElement('span');
                    addedSpan.dataset.type = 'added';
                    addedSpan.className = GREEN_CHUNK_CLASS;
                    addedSpan.textContent = part.value;
                    fragment.appendChild(addedSpan);
                    return;
                }

                if (part.removed) return;

                const removedSpan = document.createElement('span');
                removedSpan.dataset.type = 'removed';
                removedSpan.dataset.base = encodeURIComponent(part.value);
                removedSpan.contentEditable = 'false';
                removedSpan.className = RED_CHUNK_CLASS;
                removedSpan.textContent = part.value;
                fragment.appendChild(removedSpan);
            });

            el.replaceWith(fragment);
        });

        if (didRewriteRemovedSpan) {
            restoreEditableCaretOffset(canvasRef.current, caretOffset);
        }

        let newModified = '';
        const nodes = Array.from(canvasRef.current.childNodes);

        nodes.forEach((node) => {
            const text = node.textContent || '';
            if (node.nodeType !== Node.ELEMENT_NODE) {
                newModified += text;
                return;
            }

            const el = node as HTMLElement;
            const type = el.dataset.type;

            if (type !== 'removed') newModified += text;
        });

        setModified(newModified);
        setTimeout(() => {
            isSyncing.current = false;
        }, 0);
    }, []);

    const insertAddedTextAtCaret = useCallback((text: string) => {
        if (!canvasRef.current) return false;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return false;

        const range = selection.getRangeAt(0);
        if (!canvasRef.current.contains(range.commonAncestorContainer)) return false;

        range.deleteContents();
        const span = document.createElement('span');
        span.dataset.type = 'added';
        span.className = GREEN_CHUNK_CLASS;
        span.textContent = text;
        range.insertNode(span);

        range.setStartAfter(span);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
    }, []);

    const handleCanvasBeforeInput = useCallback(
        (e: React.FormEvent<HTMLDivElement>) => {
            const inputEvent = e.nativeEvent as Partial<InputEvent>;
            const inputType = typeof inputEvent.inputType === 'string' ? inputEvent.inputType : '';
            const data = typeof inputEvent.data === 'string' ? inputEvent.data : null;
            if (inputEvent.isComposing) return;

            if (inputType.startsWith('delete') && canvasRef.current) {
                const touchesRemoved = selectionTouchesRemovedChunk(canvasRef.current);
                const targetsForwardRemoved =
                    inputType.includes('Forward') && doesDeletionTargetRemovedChunk(canvasRef.current, 'forward');
                const targetsBackwardRemoved =
                    inputType.includes('Backward') && doesDeletionTargetRemovedChunk(canvasRef.current, 'backward');
                if (touchesRemoved || targetsForwardRemoved || targetsBackwardRemoved) {
                    e.preventDefault();
                    return;
                }
            }

            if (inputType.startsWith('insert') && data !== null) {
                if (canvasRef.current && selectionTouchesRemovedChunk(canvasRef.current)) {
                    e.preventDefault();
                    return;
                }
                e.preventDefault();
                if (insertAddedTextAtCaret(data)) {
                    handleCanvasInput();
                }
                return;
            }

            if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
                if (canvasRef.current && selectionTouchesRemovedChunk(canvasRef.current)) {
                    e.preventDefault();
                    return;
                }
                e.preventDefault();
                if (insertAddedTextAtCaret('\n')) {
                    handleCanvasInput();
                }
            }
        },
        [handleCanvasInput, insertAddedTextAtCaret],
    );

    const handleCanvasPaste = useCallback(
        (e: React.ClipboardEvent<HTMLDivElement>) => {
            if (canvasRef.current && selectionTouchesRemovedChunk(canvasRef.current)) {
                e.preventDefault();
                return;
            }
            e.preventDefault();
            const pastedText = e.clipboardData.getData('text/plain');
            if (!pastedText) return;
            if (insertAddedTextAtCaret(pastedText)) {
                handleCanvasInput();
            }
        },
        [handleCanvasInput, insertAddedTextAtCaret],
    );

    const handleCanvasKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.nativeEvent.isComposing) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            if (canvasRef.current && selectionTouchesRemovedChunk(canvasRef.current)) {
                if (e.key === 'Backspace' || e.key === 'Delete' || e.key.length === 1 || e.key === 'Enter') {
                    e.preventDefault();
                }
                return;
            }

            if (
                canvasRef.current &&
                e.key === 'Delete' &&
                doesDeletionTargetRemovedChunk(canvasRef.current, 'forward')
            ) {
                e.preventDefault();
                return;
            }

            if (
                canvasRef.current &&
                e.key === 'Backspace' &&
                doesDeletionTargetRemovedChunk(canvasRef.current, 'backward')
            ) {
                e.preventDefault();
                return;
            }

            if (e.key.length === 1) {
                e.preventDefault();
                if (insertAddedTextAtCaret(e.key)) handleCanvasInput();
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                if (insertAddedTextAtCaret('\n')) handleCanvasInput();
            }
        },
        [handleCanvasInput, insertAddedTextAtCaret],
    );

    const handleCanvasCut = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
        if (!canvasRef.current) return;
        if (selectionTouchesRemovedChunk(canvasRef.current)) {
            e.preventDefault();
        }
    }, []);

    const copyResult = async () => {
        await navigator.clipboard.writeText(modified);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!isHydrated) return null;

    return (
        <div className='min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100'>
            <div className='max-w-5xl mx-auto p-6 md:p-12 space-y-8'>
                {/* Header */}
                <div className='flex flex-col md:flex-row md:items-center justify-between gap-4'>
                    <div className='space-y-1'>
                        <h1 className='text-2xl font-bold tracking-tighter flex items-center gap-2'>
                            <Layers className='h-6 w-6 text-blue-600' />
                            DiffMeister
                            <span className='text-slate-300 line-through decoration-slate-400 opacity-50'>Plus</span>
                            <span className='text-slate-300 line-through decoration-slate-400 opacity-50'>Pro</span>
                            <span className='text-blue-600 font-black'>Ultra</span>
                        </h1>
                        <p className='text-xs font-medium text-slate-400 uppercase tracking-widest flex items-center gap-2'>
                            <span className='bg-slate-200/50 px-1.5 py-0.5 rounded text-[9px] font-bold'>
                                v0.1.0 Alpha
                            </span>
                        </p>
                    </div>
                    <div className='flex items-center gap-2'>
                        <Button
                            variant='outline'
                            size='sm'
                            onClick={() => {
                                setOriginal('');
                                setModified('');
                            }}
                            className='cursor-pointer'
                        >
                            <Trash2 className='h-3.5 w-3.5 mr-2' /> Reset
                        </Button>
                        <Button
                            variant='default'
                            size='sm'
                            onClick={copyResult}
                            className={cn(
                                'transition-all duration-200 cursor-pointer',
                                copied ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700',
                            )}
                        >
                            {copied ? (
                                <>
                                    <Check className='h-3.5 w-3.5 mr-2 animate-in zoom-in duration-300' /> Copied!
                                </>
                            ) : (
                                <>
                                    <Copy className='h-3.5 w-3.5 mr-2' /> Copy Final
                                </>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Source Fields (Secondary Interface) */}
                <div className='grid md:grid-cols-2 gap-6'>
                    <Textarea
                        label='Original Source (A)'
                        value={original}
                        onChange={(e) => setOriginal(e.target.value)}
                    />
                    <Textarea
                        label='Modified Version (B)'
                        value={modified}
                        onChange={(e) => setModified(e.target.value)}
                    />
                </div>

                {/* The Live Canvas (Primary Interface) */}
                <div className='space-y-3'>
                    <div className='flex items-center justify-between'>
                        <h2 className='text-sm font-bold flex items-center gap-2'>
                            <Zap className='h-4 w-4 text-amber-500 fill-amber-500' />
                            Live Synchronized Canvas
                        </h2>
                        <div className='flex gap-4 text-[10px] font-bold uppercase tracking-tighter text-slate-400'>
                            <span className='flex items-center gap-1'>
                                <span className='w-2 h-2 rounded-full bg-red-400' /> Original A (Read-Only from Canvas)
                            </span>
                            <span className='flex items-center gap-1'>
                                <span className='w-2 h-2 rounded-full bg-green-400' /> Edits Modified B
                            </span>
                            <span className='flex items-center gap-1'>
                                <span className='w-2 h-2 rounded-full bg-slate-300' /> All Canvas Edits to Modified B
                            </span>
                        </div>
                    </div>
                    <div className='border-2 border-slate-200 bg-white shadow-xl shadow-slate-200/50 overflow-hidden transition-all focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-50'>
                        <div
                            ref={canvasRef}
                            contentEditable
                            onFocus={() => setIsCanvasFocused(true)}
                            onBlur={() => setIsCanvasFocused(false)}
                            onKeyDown={handleCanvasKeyDown}
                            onBeforeInput={handleCanvasBeforeInput}
                            onPaste={handleCanvasPaste}
                            onCut={handleCanvasCut}
                            onInput={handleCanvasInput}
                            suppressContentEditableWarning
                            className='p-8 min-h-[300px] outline-none font-mono text-sm leading-relaxed whitespace-pre-wrap'
                        />
                    </div>
                </div>

                {/* Footer */}
                <footer className='pt-12 border-t border-slate-200 flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-widest'>
                    <div className='flex items-center gap-4'>
                        <span>Next.js 15</span>
                        <span>React 19</span>
                        <span>Tailwind 4</span>
                    </div>
                    <a href='#' className='hover:text-blue-600 transition-colors flex items-center gap-1'>
                        <Github className='h-3 w-3' /> Source
                    </a>
                </footer>
            </div>
        </div>
    );
}
