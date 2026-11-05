import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import IconBadge from '@/components/IconBadge';
import SearchResultsList from '@/components/SearchResultsList';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePreferredStore } from '@/hooks/usePreferredStore';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_MAX_LENGTH,
  useProductSearch,
  type ProductSearchState,
} from '@/hooks/useProductSearch';
import { useRecentProducts } from '@/hooks/useRecentProducts';
import { colors, radius, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { Product } from '@/types/product';

/**
 * Search tab: type a product name and matching products appear. The search runs once typing
 * pauses for SEARCH_DEBOUNCE_MS, not on every keystroke. The In stock filter (T096) narrows it to
 * products in stock at the shopper's own store (T078), or at any store if they haven't picked
 * one; turning it on or off searches again right away. The field takes focus whenever the tab
 * gains focus with an empty box, so it is ready to type after Home's search box or the tab bar.
 */
export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { store: preferred } = usePreferredStore();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState('');
  const [inStock, setInStock] = useState(false);
  const typed = text.trim();
  const debounced = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);
  // Only a store with its slug can filter (usePreferredStore fills in a missing one).
  const myStore = preferred?.slug ? preferred : null;
  // Clearing the box clears the results right away instead of after the pause.
  const search = useProductSearch(typed ? debounced : '', {
    store: inStock ? myStore?.slug : null,
    inStock,
  });
  const where = myStore ? `at ${myStore.name}` : 'at any store';

  // Read through a ref so typing doesn't rerun the focus effect.
  const typedRef = useRef(typed);
  useEffect(() => {
    typedRef.current = typed;
  }, [typed]);

  // A tab stays mounted, so autoFocus would only work the first time. Only focus an empty box, so
  // coming back to results (e.g. Back from a product) doesn't pop the keyboard over them.
  useFocusEffect(
    useCallback(() => {
      if (!typedRef.current) inputRef.current?.focus();
    }, []),
  );

  return (
    <View style={sharedStyles.screen}>
      <View style={[sharedStyles.headerBand, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Search</Text>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={sizes.icon} color={colors.textSecondary} />
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder="Search products or brands"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Search products"
            // Longer searches would only get a validation error from the API.
            maxLength={SEARCH_MAX_LENGTH}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={styles.input}
          />
          {text ? (
            <Pressable
              onPress={() => setText('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={spacing.sm}
            >
              <Ionicons name="close-circle" size={sizes.icon} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.filters}>
          <FilterChip
            label={`In stock ${where}`}
            icon="checkmark-circle-outline"
            selected={inStock}
            onPress={() => setInStock((on) => !on)}
          />
          {myStore ? null : (
            <Pressable
              onPress={() => router.push('/stores')}
              accessibilityRole="button"
              accessibilityLabel="Choose your store to filter by it"
              style={styles.chip}
            >
              <Ionicons name="storefront-outline" size={sizes.icon} color={colors.textOnHeader} />
              <Text style={styles.chipText}>Choose your store</Text>
            </Pressable>
          )}
        </View>
      </View>

      <SearchContent
        state={search}
        filtered={inStock ? `in stock ${where}` : null}
        onOpen={(product) => router.push(`/product/${product.id}`)}
      />
    </View>
  );
}

/** A filter that's on or off, e.g. "In stock", as a chip on the navy band. */
function FilterChip({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  selected: boolean;
  onPress: () => void;
}) {
  const color = selected ? colors.textPrimary : colors.textOnHeader;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Ionicons name={icon} size={sizes.icon} color={color} />
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SearchContent({
  state: { query, loading, results, error, reload },
  filtered,
  onOpen,
}: {
  state: ProductSearchState;
  /** The filter that's on, e.g. "in stock at Camp Lejeune MCX", or null for none. */
  filtered: string | null;
  onOpen: (product: Product) => void;
}) {
  const router = useRouter();

  if (!query) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled">
        <Message
          icon="search-outline"
          title="Find a product"
          text="Search by product name, e.g. coffee or chips."
        />
        <RecentlyViewed />
      </ScrollView>
    );
  }

  return (
    <AsyncContent
      loading={loading}
      error={error?.message}
      onRetry={reload}
      loadingMessage="Searching…"
    >
      {results?.length === 0 ? (
        <Message
          icon="help-circle-outline"
          title="No results"
          text={
            filtered
              ? `No products match "${query}" ${filtered}. Try turning off "In stock".`
              : `No products match "${query}". Check the spelling or try fewer words.`
          }
        >
          <Text style={[sharedStyles.secondaryText, styles.center]}>
            Or try the barcode scanner.
          </Text>
          <Button
            title="Scan a barcode"
            variant="action"
            icon="scan-outline"
            onPress={() => router.navigate('/scan')}
          />
        </Message>
      ) : (
        <SearchResultsList results={results ?? []} onOpen={onOpen} />
      )}
    </AsyncContent>
  );
}

/** The products the shopper opened lately as quick links; only mounted while the box is empty. */
function RecentlyViewed() {
  const router = useRouter();
  const { products } = useRecentProducts();
  if (products.length === 0) return null;

  return (
    <View style={styles.recent}>
      <Text style={sharedStyles.sectionTitle}>Recently viewed</Text>
      <View style={styles.recentLinks}>
        {products.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => router.push(`/product/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}`}
            style={({ pressed }) => [styles.recentLink, pressed && styles.pressed]}
          >
            <Ionicons name="time-outline" size={sizes.icon} color={colors.textSecondary} />
            <Text style={styles.recentText} numberOfLines={1}>
              {item.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Message({
  icon,
  title,
  text,
  children,
}: {
  icon: ComponentProps<typeof IconBadge>['icon'];
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <View style={[sharedStyles.centered, styles.message]} accessibilityLiveRegion="polite">
      <IconBadge icon={icon} />
      <Text style={[sharedStyles.heading, styles.center]}>{title}</Text>
      <Text style={[sharedStyles.secondaryText, styles.center]}>{text}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  title: {
    ...textStyles.title,
    color: colors.textOnHeader,
  },
  searchBar: {
    ...sharedStyles.row,
    height: sizes.button,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  input: {
    ...textStyles.body,
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    ...sharedStyles.row,
    gap: spacing.xs,
    maxWidth: '100%',
    height: sizes.avatar,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.headerChip,
  },
  chipSelected: {
    backgroundColor: colors.surface,
  },
  chipText: {
    ...textStyles.label,
    flexShrink: 1,
    color: colors.textOnHeader,
  },
  message: {
    gap: spacing.md,
    padding: spacing.xl,
  },
  center: {
    textAlign: 'center',
  },
  recent: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  recentLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  recentLink: {
    ...sharedStyles.row,
    gap: spacing.xs,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  recentText: {
    ...textStyles.caption,
    flexShrink: 1,
    color: colors.textPrimary,
  },
});
