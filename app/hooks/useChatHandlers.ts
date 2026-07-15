import { RefObject, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useGlobalState } from "../contexts/GlobalState";
import { useLatestRef } from "@/app/hooks/useLatestRef";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import { shouldUseAgentLongForAgent } from "@/lib/chat/agent-routing";
import { isAgentMode } from "@/lib/utils/mode-helpers";
import type { ChatMessage, ChatStatus } from "@/types";
import { Id } from "@/convex/_generated/dataModel";
import {
  countInputTokens,
  getMaxTokensForSubscription,
  getMaxFileTokens,
} from "@/lib/token-utils";
import { toast } from "sonner";
import { removeTodosBySourceMessages } from "@/lib/utils/todo-utils";
import { useDataStreamDispatch } from "@/app/components/DataStreamProvider";
import { normalizeMessages } from "@/lib/utils/message-processor";
import {
  getAutoContinueChainAssistantIds,
  getMessagesUpToLastRealUser,
} from "@/lib/utils/message-utils";
import {
  createFileMessagePartFromUploadedFile,
  getMaxFilesLimitForMode,
} from "@/lib/utils/file-utils";
import { createAISDKFilePart } from "@/lib/utils/file-part-adapter";
import { hasRestageableLocalDesktopAttachments } from "@/lib/utils/local-attachment-messages";
import { readStoredModelAccessCode } from "@/lib/model-access";

interface UseChatHandlersProps {
  chatId: string;
  messages: ChatMessage[];
  sendMessage: (message?: any, options?: { body?: any }) => void;
  stop: () => void;
  regenerate: (options?: { body?: any }) => void;
  setMessages: (
    messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => void;
  isExistingChat: boolean;
  status: ChatStatus;
  isSendingNowRef: RefObject<boolean>;
  hasManuallyStoppedRef: RefObject<boolean>;
  onStopCallback?: () => void;
  resetAutoContinueCount?: () => void;
}

export const useChatHandlers = ({
  chatId,
  messages,
  sendMessage,
  stop,
  regenerate,
  setMessages,
  isExistingChat,
  status,
  isSendingNowRef,
  hasManuallyStoppedRef,
  onStopCallback,
  resetAutoContinueCount,
}: UseChatHandlersProps) => {
  const { setIsAutoResuming } = useDataStreamDispatch();
  const {
    input,
    uploadedFiles,
    chatMode,
    clearInput,
    clearUploadedFiles,
    todos,
    setTodos,
    isUploadingFiles,
    subscription,
    temporaryChatsEnabled,
    queueMessage,
    messageQueue,
    removeQueuedMessage,
    queueBehavior,
    sandboxPreference,
    selectedModel,
  } = useGlobalState();

  // Avoid stale closure on temporary flag
  const temporaryChatsEnabledRef = useRef(temporaryChatsEnabled);
  useEffect(() => {
    temporaryChatsEnabledRef.current = temporaryChatsEnabled;
  }, [temporaryChatsEnabled]);

  // Avoid stale closure on chatMode: on mobile, a tap on Regenerate can fire
  // before React commits the new chatMode after a mode toggle, sending the
  // previous mode in the request body. Reading from a ref always gets the
  // latest value at the moment of the click.
  const chatModeRef = useLatestRef(chatMode);
  const sandboxPreferenceRef = useLatestRef(sandboxPreference);
  const subscriptionRef = useLatestRef(subscription);

  const isSendableUploadedFile = (file: (typeof uploadedFiles)[number]) =>
    file.uploaded &&
    !file.uploading &&
    !file.error &&
    (file.storage === "local-desktop"
      ? !!file.localAttachmentId && !!file.localPath
      : !!file.url && !!file.fileId);

  const deleteLastAssistantMessage = useMutation(
    api.messages.deleteLastAssistantMessage,
  );
  const saveAssistantMessage = useMutation(api.messages.saveAssistantMessage);
  const regenerateWithNewContent = useMutation(
    api.messages.regenerateWithNewContent,
  );
  const cancelStreamMutation = useMutation(
    api.chatStreams.cancelStreamFromClient,
  );
  const cancelTempStreamMutation = useMutation(
    api.tempStreams.cancelTempStreamFromClient,
  );

  // Mirrors the transport routing rule in app/components/chat.tsx. Persistent
  // chats only; temporary chats use the legacy Redis pub/sub cancel path.
  const shouldCancelTriggerRun = () =>
    !temporaryChatsEnabledRef.current &&
    shouldUseAgentLongForAgent({
      mode: chatModeRef.current,
      subscription: subscriptionRef.current,
      isTauri: isTauriEnvironment(),
    });

  const cancelTriggerRun = () => {
    if (!shouldCancelTriggerRun()) return;
    fetch("/api/agent-long/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    }).catch((error) => {
      console.error("Failed to cancel trigger.dev run:", error);
    });
  };

  /**
   * Helper to stop an active stream, normalize messages, and persist state.
   * Returns the normalized messages array.
   * Should be called before any message management operation during streaming.
   */
  const stopActiveStream = async (options?: {
    skipSave?: boolean;
  }): Promise<ChatMessage[]> => {
    // Stop the stream immediately (client-side abort)
    stop();

    // Early return if no messages to process
    if (messages.length === 0) return messages;

    // Normalize messages to mark incomplete tools as interrupted/completed
    const { messages: normalizedMessages, hasChanges } =
      normalizeMessages(messages);

    const stopTime = Date.now();
    const normalizedLastMessage =
      normalizedMessages[normalizedMessages.length - 1];
    const generationStartedAt =
      typeof normalizedLastMessage?.metadata?.generationStartedAt === "number"
        ? normalizedLastMessage.metadata.generationStartedAt
        : undefined;
    const generationTimeMs =
      generationStartedAt !== undefined
        ? Math.max(0, stopTime - generationStartedAt)
        : undefined;
    const stoppedMessages =
      normalizedLastMessage?.role === "assistant" &&
      generationTimeMs !== undefined
        ? [
            ...normalizedMessages.slice(0, -1),
            {
              ...normalizedLastMessage,
              metadata: {
                ...normalizedLastMessage.metadata,
                mode:
                  normalizedLastMessage.metadata?.mode ?? chatModeRef.current,
                generationStartedAt,
                generationTimeMs,
              },
            },
          ]
        : normalizedMessages;

    // Update local state if changes were made
    if (hasChanges || stoppedMessages !== normalizedMessages) {
      setMessages(stoppedMessages);
    }

    if (!temporaryChatsEnabledRef.current) {
      // Run cancel and save in parallel - they're independent operations
      const lastMessage = stoppedMessages[stoppedMessages.length - 1];
      const savePromise =
        !options?.skipSave && lastMessage?.role === "assistant"
          ? saveAssistantMessage({
              id: lastMessage.id,
              chatId,
              role: lastMessage.role,
              parts: lastMessage.parts,
              mode: lastMessage.metadata?.mode ?? chatModeRef.current,
              generationStartedAt,
              generationTimeMs,
            }).catch((error) => {
              console.error("Failed to save message on stop:", error);
            })
          : Promise.resolve();

      await Promise.all([
        cancelStreamMutation({
          chatId,
          skipSave: options?.skipSave || undefined,
        }).catch((error) => {
          console.error("Failed to cancel stream:", error);
        }),
        savePromise,
      ]);
    } else {
      // Temporary chats: signal cancel via temp stream coordination
      await cancelTempStreamMutation({ chatId }).catch(() => {});
    }

    return normalizedMessages;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsAutoResuming(false);

    // Reset manual stop flag when user submits a new message
    hasManuallyStoppedRef.current = false;
    resetAutoContinueCount?.();

    // Prevent submission if files are still uploading
    if (isUploadingFiles) {
      return;
    }
    // Allow submission if there's text input or uploaded files
    const hasValidFiles = uploadedFiles.some(isSendableUploadedFile);
    if (input.trim() || hasValidFiles) {
      const maxFilesLimit = getMaxFilesLimitForMode(chatMode);
      if (uploadedFiles.length > maxFilesLimit) {
        toast.error("Cannot send files in this mode", {
          description: `Maximum ${maxFilesLimit} files allowed. Please remove some files or switch modes.`,
        });
        return;
      }

      const currentChatMode = chatModeRef.current;
      const hasLocalDesktopFiles = uploadedFiles.some(
        (file) => file.storage === "local-desktop",
      );
      if (
        hasLocalDesktopFiles &&
        (!isAgentMode(currentChatMode) ||
          sandboxPreferenceRef.current !== "desktop")
      ) {
        toast.error("Local attachments require desktop Agent mode", {
          description:
            "Switch back to Agent mode with the desktop sandbox or reattach the file for upload.",
        });
        return;
      }

      // If streaming in Agent mode, check queue behavior
      if (status === "streaming") {
        const validFiles = uploadedFiles
          .filter(isSendableUploadedFile)
          .map(createFileMessagePartFromUploadedFile)
          .filter((part): part is NonNullable<typeof part> => part !== null);

        if (queueBehavior === "queue") {
          // Queue the message - will auto-send after current response completes
          queueMessage(input, validFiles);
          clearInput();
          clearUploadedFiles();
          return;
        } else if (queueBehavior === "stop-and-send") {
          // Immediately stop current stream and send right away
          stop();

          // Cancel the trigger.dev run for agent-long streams so the prior
          // run stops burning compute instead of finishing in the background.
          cancelTriggerRun();

          // Cancel the stream in database and save current message state
          if (!temporaryChatsEnabledRef.current) {
            cancelStreamMutation({ chatId }).catch((error) => {
              console.error("Failed to cancel stream:", error);
            });

            const lastMessage = messages[messages.length - 1];
            if (lastMessage && lastMessage.role === "assistant") {
              saveAssistantMessage({
                id: lastMessage.id,
                chatId,
                role: lastMessage.role,
                parts: lastMessage.parts,
              }).catch((error) => {
                console.error("Failed to save message on stop:", error);
              });
            }
          } else {
            // Temporary chats: signal cancel via temp stream coordination
            cancelTempStreamMutation({ chatId }).catch(() => {});
          }
          // Continue to send the new message immediately below (don't return)
        }
      }
      // Check token limit before sending based on user plan
      const tokenCount = countInputTokens(input, uploadedFiles);
      const maxTokens = getMaxTokensForSubscription(subscription, {
        mode: currentChatMode,
      });

      // Additional validation for Ask mode: ensure files don't exceed Ask mode token limits
      // This prevents uploading files in Agent mode then switching to Ask mode to send them
      if (currentChatMode === "ask" && uploadedFiles.length > 0) {
        const fileTokens = uploadedFiles.reduce(
          (total, file) => total + (file.tokens || 0),
          0,
        );
        const maxFileTokens = getMaxFileTokens(subscription);
        if (fileTokens > maxFileTokens) {
          toast.error("Cannot send files in Ask mode", {
            description: `Files exceed Ask mode token limit (${fileTokens.toLocaleString()}/${maxFileTokens.toLocaleString()} tokens). Tip: Switch to Agent mode or remove large files.`,
          });
          return;
        }
      }

      if (tokenCount > maxTokens) {
        const hasFiles = uploadedFiles.length > 0;
        const planText = subscription !== "free" ? "" : " (Free plan limit)";
        toast.error("Message is too long", {
          description: `Your message is too large (${tokenCount.toLocaleString()} tokens). Please make it shorter${hasFiles ? " or remove some files" : ""}${planText}.`,
        });
        return;
      }
      if (!isExistingChat && !temporaryChatsEnabledRef.current) {
        window.history.replaceState({}, "", `/c/${chatId}`);
      }

      try {
        // Get file objects from uploaded files - load actual bytes for AI SDK v6 compatibility
        const validFileParts = await Promise.all(
          uploadedFiles
            .filter(isSendableUploadedFile)
            .map(createAISDKFilePart)
        );
        const validFiles = validFileParts.filter((part): part is NonNullable<typeof part> => part !== null);

        sendMessage(
          {
            text: input.trim() || undefined,
            files: validFiles.length > 0 ? validFiles : undefined,
            metadata: { createdAt: Date.now() },
          },
          {
            body: {
              mode: currentChatMode,
              todos,
              temporary: temporaryChatsEnabled,
              sandboxPreference,

              selectedModel,
              modelAccessCode: readStoredModelAccessCode(),
            },
          },
        );
      } catch (error) {
        console.error("Failed to process files:", error);
        // Fallback to text-only message if file processing fails
        sendMessage(
          { text: input, metadata: { createdAt: Date.now() } },
          {
            body: {
              mode: currentChatMode,
              todos,
              temporary: temporaryChatsEnabled,
              sandboxPreference,

              selectedModel,
              modelAccessCode: readStoredModelAccessCode(),
            },
          },
        );
      }

      clearInput();
      clearUploadedFiles();
    }
  };

  const handleStop = async () => {
    setIsAutoResuming(false);

    // Set manual stop flag to prevent auto-processing of queue
    hasManuallyStoppedRef.current = true;

    // Clear any active status indicators immediately
    onStopCallback?.();

    // Fire the trigger.dev cancel in parallel with stopActiveStream so the
    // Trigger.dev API round-trip overlaps the Convex cancel/save instead of
    // sequencing after it.
    cancelTriggerRun();

    try {
      await stopActiveStream();
    } catch (error) {
      console.error("Error in handleStop:", error);
    }
  };

  const handleRegenerate = async () => {
    setIsAutoResuming(false);
    resetAutoContinueCount?.();

    // Stop any active stream first to prevent message order issues and wasted tokens
    if (status === "streaming") {
      await stopActiveStream({ skipSave: true });
    }

    // Remove todos from all assistant messages in the auto-continue chain.
    const chainAssistantIds = getAutoContinueChainAssistantIds(messages);
    const cleanedTodos =
      chainAssistantIds.length > 0
        ? removeTodosBySourceMessages(todos, chainAssistantIds)
        : todos;
    if (cleanedTodos !== todos) setTodos(cleanedTodos);

    // Trim client-side message state to the last real user message.
    // Without this, the SDK's regenerate() only removes the last assistant,
    // leaving old auto-continue chain messages visible in the UI.
    const trimmedMessages = getMessagesUpToLastRealUser(messages);
    setMessages(trimmedMessages);

    const shouldSendClientMessagesForRegenerate =
      hasRestageableLocalDesktopAttachments(trimmedMessages);
    const persistentRegenerateMessages = shouldSendClientMessagesForRegenerate
      ? trimmedMessages
      : [];

    if (!temporaryChatsEnabled) {
      // Delete the entire trailing auto-continue chain (all assistant + hidden user messages)
      // back to the last real user message, so regeneration starts from the original request
      if (chainAssistantIds.length > 0) {
        await deleteLastAssistantMessage({
          chatId,
          todos: cleanedTodos,
        });
      }
      // For persisted chats, backend fetches from database - explicitly send no messages
      regenerate({
        body: {
          mode: chatModeRef.current,
          messages: persistentRegenerateMessages,
          todos: cleanedTodos,
          regenerate: true,
          useClientMessagesForRegenerate: shouldSendClientMessagesForRegenerate,
          temporary: false,
          sandboxPreference,
          selectedModel,
          modelAccessCode: readStoredModelAccessCode(),
        },
      });
    } else {
      regenerate({
        body: {
          mode: chatModeRef.current,
          messages: trimmedMessages,
          todos: cleanedTodos,
          regenerate: true,
          temporary: true,
          sandboxPreference,
          selectedModel,
          modelAccessCode: readStoredModelAccessCode(),
        },
      });
    }
  };

  const handleRetry = async () => {
    setIsAutoResuming(false);
    resetAutoContinueCount?.();

    // Stop any active stream first to prevent message order issues and wasted tokens
    if (status === "streaming") {
      await stopActiveStream({ skipSave: true });
    }

    const cleanedTodos = removeTodosBySourceMessages(
      todos,
      todos
        .filter((t) => t.sourceMessageId)
        .map((t) => t.sourceMessageId as string),
    );
    if (cleanedTodos !== todos) setTodos(cleanedTodos);
    if (!temporaryChatsEnabled) {
      // For persisted chats, backend fetches from database - explicitly send no messages
      regenerate({
        body: {
          mode: chatModeRef.current,
          messages: [],
          todos: cleanedTodos,
          regenerate: true,
          temporary: false,
          sandboxPreference,
          selectedModel,
          modelAccessCode: readStoredModelAccessCode(),
        },
      });
    } else {
      // For temporary chats, filter out empty assistant message if present (from error)
      // Check if last message is an empty assistant message
      const lastMessage = messages[messages.length - 1];
      const isLastMessageEmptyAssistant =
        lastMessage?.role === "assistant" &&
        (!lastMessage.parts || lastMessage.parts.length === 0);

      const messagesToSend = isLastMessageEmptyAssistant
        ? messages.slice(0, -1)
        : messages;

      regenerate({
        body: {
          mode: chatModeRef.current,
          messages: messagesToSend,
          todos: cleanedTodos,
          regenerate: true,
          temporary: true,
          sandboxPreference,

          selectedModel,
          modelAccessCode: readStoredModelAccessCode(),
        },
      });
    }
  };

  const handleEditMessage = async (
    messageId: string,
    newContent: string,
    remainingFileIds?: string[],
  ) => {
    setIsAutoResuming(false);

    // Stop any active stream first to prevent message order issues and wasted tokens
    if (status === "streaming") {
      await stopActiveStream({ skipSave: true });
    }

    // Find the edited message index to identify subsequent messages
    const editedMessageIndex = messages.findIndex((m) => m.id === messageId);

    if (editedMessageIndex !== -1) {
      // Get all subsequent messages (both user and assistant) that will be removed
      const subsequentMessages = messages.slice(editedMessageIndex + 1);
      const idsToClean = subsequentMessages.map((m) => m.id);

      // Also clean todos from the edited message itself if it's an assistant message
      const editedMessage = messages[editedMessageIndex];
      if (editedMessage.role === "assistant") {
        idsToClean.push(messageId);
      }

      // Remove todos linked to the edited message and all subsequent messages
      if (idsToClean.length > 0) {
        const updatedTodos = removeTodosBySourceMessages(todos, idsToClean);
        setTodos(updatedTodos);
      }
    }

    if (!temporaryChatsEnabled) {
      try {
        await regenerateWithNewContent({
          messageId: messageId as Id<"messages">,
          newContent,
          fileIds: remainingFileIds,
        });
      } catch (error) {
        // Swallow benign errors (e.g., racing edits where the message was already removed)
        // Avoid logging to keep console clean
      }
    }

    // Build updated parts: text + remaining file parts
    const buildUpdatedParts = (currentParts: any[]) => {
      const newParts: any[] = [];

      // Add text part if there's content
      if (newContent.trim()) {
        newParts.push({ type: "text", text: newContent });
      }

      // Keep file parts that are in remainingFileIds
      if (remainingFileIds && remainingFileIds.length > 0) {
        const remainingFileParts = currentParts.filter(
          (part) =>
            part.type === "file" &&
            part.fileId &&
            remainingFileIds.includes(part.fileId),
        );
        newParts.push(...remainingFileParts);
      }

      return newParts;
    };

    // Update local state to reflect the edit and remove subsequent messages
    setMessages((prevMessages) => {
      const editedMessageIndex = prevMessages.findIndex(
        (msg) => msg.id === messageId,
      );

      if (editedMessageIndex === -1) return prevMessages;

      const updatedMessages = prevMessages.slice(0, editedMessageIndex + 1);
      const currentMessage = updatedMessages[editedMessageIndex];
      updatedMessages[editedMessageIndex] = {
        ...currentMessage,
        parts: buildUpdatedParts(currentMessage.parts),
      };

      return updatedMessages;
    });

    // Trigger regeneration of assistant response with cleaned todos
    const cleanedTodosForEdit = (() => {
      const editedIndex = messages.findIndex((m) => m.id === messageId);
      if (editedIndex === -1) return todos;
      const subsequentMessages = messages.slice(editedIndex + 1);
      const idsToClean = subsequentMessages.map((m) => m.id);
      const editedMessage = messages[editedIndex];
      if (editedMessage.role === "assistant") idsToClean.push(messageId);
      return removeTodosBySourceMessages(todos, idsToClean);
    })();

    // For persisted chats, backend fetches from database
    // For temporary chats, send all messages up to and including the edited message
    if (!temporaryChatsEnabled) {
      regenerate({
        body: {
          mode: chatModeRef.current,
          messages: [],
          todos: cleanedTodosForEdit,
          regenerate: true,
          temporary: false,
          sandboxPreference,

          selectedModel,
          modelAccessCode: readStoredModelAccessCode(),
        },
      });
    } else {
      // For temporary chats, send messages up to and including the edited message
      const messagesUpToEdit = messages.slice(0, editedMessageIndex + 1);
      const editedMessage = messages[editedMessageIndex];

      // Build updated parts for the edited message
      const updatedParts: any[] = [];
      if (newContent.trim()) {
        updatedParts.push({ type: "text", text: newContent });
      }
      if (remainingFileIds && remainingFileIds.length > 0) {
        const remainingFileParts = editedMessage.parts.filter(
          (part: any) =>
            part.type === "file" &&
            part.fileId &&
            remainingFileIds.includes(part.fileId),
        );
        updatedParts.push(...remainingFileParts);
      }

      messagesUpToEdit[editedMessageIndex] = {
        ...editedMessage,
        parts: updatedParts,
      };

      regenerate({
        body: {
          mode: chatModeRef.current,
          messages: messagesUpToEdit,
          todos: cleanedTodosForEdit,
          regenerate: true,
          temporary: true,
          sandboxPreference,

          selectedModel,
          modelAccessCode: readStoredModelAccessCode(),
        },
      });
    }
  };

  const handleContinue = async () => {
    if (status === "streaming") return;
    hasManuallyStoppedRef.current = false;

    // ── Durable Resume: try persistent checkpoint first ──
    let resumeContext = "";
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/checkpoint`);
      if (res.ok) {
        const checkpoint = await res.json();
        if (checkpoint && checkpoint.goal) {
          // Include saved message history from checkpoint when runtime messages are empty
          const savedMsgs = checkpoint.messagesJson || [];
          const messageHistory = savedMsgs.length > 0
            ? savedMsgs.map((m: any) => `${m.role}: ${m.text}`).join("\n")
            : "(no saved messages)";

          resumeContext = [
            "=== DURABLE RESUME PROTOCOL (from SQLite checkpoint) ===",
            `Chat ID: ${chatId}`,
            `Goal: ${checkpoint.goal}`,
            `Plan: ${JSON.stringify(checkpoint.plannerState || {})}`,
            `Execution journal: ${checkpoint.executionJournal?.length || 0} entries`,
            `Scratchpad: ${(checkpoint.scratchpad || "").substring(0, 200)}`,
            `Saved messages: ${messages.length > 0 ? 'present in conversation' : savedMsgs.length + ' from checkpoint'}`,
            `Last updated: ${new Date(checkpoint.updatedAt).toISOString()}`,
            messages.length === 0 && savedMsgs.length > 0 ? `\n=== SAVED MESSAGE HISTORY ===\n${messageHistory}\n=== END HISTORY ===` : "",
            "",
            "INSTRUCTIONS:",
            "1. The conversation history above contains all prior messages.",
            "2. The checkpoint describes what was in progress when execution stopped.",
            "3. Continue EXACTLY from where you left off.",
            "4. Do NOT restart completed work.",
            "5. Do NOT ask for context — it is provided above.",
            "=== END DURABLE RESUME ===",
          ].filter(Boolean).join("\n");
        }
      }
    } catch { resumeContext = ""; }

    // ── Fallback: messages are empty? Use explicit recovery ──
    if (!resumeContext || messages.length === 0) {
      resumeContext = [
        "=== RECOVERY PROTOCOL ===",
        `Chat ID: ${chatId}`,
        "",
        "The conversation history may have been lost due to a browser refresh or server restart.",
        "Check the checkpoint at /api/chats/${chatId}/checkpoint for saved state.",
        "If no previous context is available, respond with:",
        "\"I have no previous context for this conversation. Please describe what you need.\"",
        "=== END RECOVERY ===",
      ].join("\n");
    }

    // ── Runtime state build (has messages) ──
    if (messages.length > 0) {
      const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
      const lastUserMsg = [...messages].reverse().find(m => m.role === "user");

      const toolCalls = (lastAssistant as any)?.parts
        ?.filter((p: any) => p.type?.startsWith("tool-"))
        .map((p: any) => ({
          tool: p.type?.replace("tool-", ""),
          state: p.state,
          input: p.input ? JSON.stringify(p.input).substring(0, 100) : "",
          output: p.output ? JSON.stringify(p.output).substring(0, 100) : "(pending)",
        })) || [];

      const textParts = (lastAssistant as any)?.parts
        ?.filter((p: any) => p.type === "text")
        .map((p: any) => (p as any).text || "") || [];

      const summary = textParts.join(" ").substring(0, 200);

      resumeContext = [
        "=== RESUME PROTOCOL (from runtime state) ===",
        `Last user request: "${(lastUserMsg as any)?.parts?.[0]?.text?.substring(0, 100) || "(unknown)"}"`,
        `Last assistant response summary: "${summary || "(tool execution in progress)"}"`,
        toolCalls.length > 0 ? `In-progress tool calls (${toolCalls.length}):` : "",
        ...toolCalls.map(t =>
          `  - ${t.tool}: state=${t.state} input=${t.input} output=${t.output}`
        ),
        "",
        "INSTRUCTIONS:",
        "1. Review the conversation above to understand the task and current state.",
        "2. Identify which tool calls completed and which are still pending.",
        "3. Continue EXACTLY from where you left off. Do NOT restart completed work.",
        "4. If a tool call was interrupted, check its output and decide next action.",
        "5. Produce your next response as if the interruption never happened.",
        `6. There are ${messages.length} prior messages. Reply in user's language.`,
        "=== END RESUME PROTOCOL ===",
      ].join("\n");
    }

    sendMessage(
      { text: resumeContext, metadata: { isAutoContinue: true } },
      {
        body: {
          mode: chatModeRef.current,
          isAutoContinue: true,
          todos,
          temporary: temporaryChatsEnabled,
          sandboxPreference,
          selectedModel,
          modelAccessCode: readStoredModelAccessCode(),
        },
      },
    );
  };

  const handleSendNow = async (messageId: string) => {
    const message = messageQueue.find((m) => m.id === messageId);
    if (!message) return;

    // Set flag to prevent auto-processing from interfering
    isSendingNowRef.current = true;

    // Reset manual stop flag when using Send Now
    hasManuallyStoppedRef.current = false;

    try {
      // Remove the message from queue FIRST (before stopping)
      removeQueuedMessage(messageId);

      // Stop the stream using the shared helper
      setIsAutoResuming(false);
      await stopActiveStream();

      // Send the queued message immediately
      const validFiles = message.files || [];
      const messagePayload: any = {};

      // Only add text if it exists
      if (message.text) {
        messagePayload.text = message.text;
      }

      // Only add files if they exist
      if (validFiles.length > 0) {
        messagePayload.files = validFiles;
      }

      messagePayload.metadata = { createdAt: message.timestamp };

      sendMessage(messagePayload, {
        body: {
          mode: chatModeRef.current,
          todos,
          temporary: temporaryChatsEnabled,
          sandboxPreference,

          selectedModel,
          modelAccessCode: readStoredModelAccessCode(),
        },
      });
    } catch (error) {
      console.error("Failed to send queued message:", error);
    } finally {
      // Clear flag after a brief delay to allow status to change
      setTimeout(() => {
        isSendingNowRef.current = false;
      }, 200);
    }
  };

  return {
    handleSubmit,
    handleStop,
    handleRegenerate,
    handleRetry,
    handleEditMessage,
    handleSendNow,
    handleContinue,
  };
};
