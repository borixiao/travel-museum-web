export interface PlaceSuggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

export async function searchPlaces(input: string): Promise<PlaceSuggestion[]> {
  if (input.trim().length < 2) return [];
  const res = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(input)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to search locations');
  }
  return (data.suggestions ?? []) as PlaceSuggestion[];
}
