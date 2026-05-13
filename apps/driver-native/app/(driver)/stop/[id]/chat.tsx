// Pantalla "Chat con supervisor" — Fase N5.
//
// El chat existe ligado a un `delivery_report` (1-a-1 con stop). En la versión
// V1:
//   - Sólo accesible si hay report (stop completed o submitted). El botón
//     en stop/[id]/index sólo aparece en ese caso.
//   - Send text only — la captura de imagen entra con N5-bis (issue #199).
//   - Realtime via supabase channel `chat:{reportId}`.
//   - El AI mediator NO corre desde native (ver ADR-082) — todos los mensajes
//     escalan al supervisor.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ChatMessage } from '@tripdrive/types';
import { colors } from '@/theme/colors';
import { formatTimeInZone } from '@/lib/datetime';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import { getReportIdForStop } from '@/lib/queries/messages';
import { sendMessage } from '@/lib/actions/send-message';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [reportId, setReportId] = useState<string | null>(null);
  const [resolvingReport, setResolvingReport] = useState(true);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      try {
        const rid = await getReportIdForStop(id);
        if (!cancelled) setReportId(rid);
      } finally {
        if (!cancelled) setResolvingReport(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const { messages, isLoading, error } = useChatRealtime(reportId);

  // Auto-scroll al final cada vez que llega un mensaje nuevo.
  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    if (!reportId || !text.trim() || sending) return;
    setSending(true);
    const value = text;
    setText(''); // optimistic clear
    const res = await sendMessage(reportId, value);
    if (!res.ok) {
      setText(value); // restore para que el chofer pueda retry
      Alert.alert('No se pudo enviar', res.error);
    }
    setSending(false);
  }, [reportId, text, sending]);

  if (resolvingReport) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }
  if (!reportId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Header onBack={() => router.back()} />
        <View style={styles.centered}>
          <Text style={styles.emptyEmoji}>💬</Text>
          <Text style={styles.emptyTitle}>Aún no hay chat</Text>
          <Text style={styles.emptyText}>
            El chat se habilita cuando reportas la entrega. Si necesitas avisar a tu
            supervisor algo urgente, usa WhatsApp por ahora.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>⚠ {error}</Text>
          </View>
        ) : null}

        {isLoading && messages.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageBubble msg={item} />}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.msgSep} />}
            ListEmptyComponent={
              <View style={styles.emptyConvoBox}>
                <Text style={styles.emptyEmoji}>👋</Text>
                <Text style={styles.emptyConvoText}>
                  Aún no hay mensajes. Escribe el primero — tu supervisor recibirá una
                  notificación.
                </Text>
              </View>
            }
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Escribe un mensaje…"
            placeholderTextColor={colors.textFaint}
            value={text}
            onChangeText={setText}
            multiline
            editable={!sending}
            maxLength={2000}
          />
          <Pressable
            onPress={handleSend}
            disabled={!text.trim() || sending}
            style={({ pressed }) => [
              styles.sendBtn,
              (!text.trim() || sending) && styles.sendBtnDisabled,
              pressed && text.trim() && !sending && styles.sendBtnPressed,
            ]}
          >
            {sending ? (
              <ActivityIndicator color="#0c1410" size="small" />
            ) : (
              <Text style={styles.sendBtnText}>Enviar</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.backArrow}>← Atrás</Text>
      </Pressable>
      <Text style={styles.title}>Chat con supervisor</Text>
      <View style={{ width: 64 }} />
    </View>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isMine = msg.sender === 'driver';
  const isSystem = msg.sender === 'system';
  const senderLabel =
    msg.sender === 'driver'
      ? 'Tú'
      : msg.sender === 'zone_manager'
        ? 'Supervisor'
        : 'TripDrive';

  return (
    <View
      style={[
        styles.bubbleRow,
        isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isMine && styles.bubbleMine,
          isSystem && styles.bubbleSystem,
        ]}
      >
        {!isMine ? <Text style={styles.bubbleSender}>{senderLabel}</Text> : null}
        {msg.text ? (
          <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
            {msg.text}
          </Text>
        ) : null}
        <Text style={[styles.bubbleTime, isMine && styles.bubbleTimeMine]}>
          {formatTimeInZone(msg.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backArrow: { color: colors.brand, fontSize: 15, fontWeight: '600', width: 64 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 320,
  },
  emptyConvoBox: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 40, gap: 6 },
  emptyConvoText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  errorBanner: {
    backgroundColor: colors.dangerSurface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.danger,
  },
  errorBannerText: { color: colors.danger, fontSize: 12, fontWeight: '500' },

  listContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 },
  msgSep: { height: 4 },

  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '78%',
    backgroundColor: colors.surface2,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleMine: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  bubbleSystem: {
    backgroundColor: colors.infoSurface,
    borderColor: colors.info,
    alignSelf: 'center',
  },
  bubbleSender: { color: colors.textFaint, fontSize: 11, fontWeight: '600' },
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 19 },
  bubbleTextMine: { color: '#0c1410' },
  bubbleTime: { color: colors.textFaint, fontSize: 10, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: '#0c1410aa' },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface1,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: colors.brand,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnPressed: { backgroundColor: colors.brandDark },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#0c1410', fontWeight: '700', fontSize: 13 },
});
