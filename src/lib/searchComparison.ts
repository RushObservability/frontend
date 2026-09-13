const operators = ['!=', '>=', '<=', '=', '>', '<'] as const
type SearchOperator = typeof operators[number]

/** Split an autocomplete token into a field, comparison operator, and raw value. */
export function parseSearchComparison(token: string): { field: string; operator: SearchOperator; value: string } | null {
  let index = 0
  while (index < token.length && !'=!<>'.includes(token[index]!)) index++
  if (index === 0 || index === token.length) return null
  const field = token.slice(0, index)
  const operator = operators.find(candidate => token.startsWith(candidate, index))
  if (!operator) return null
  return { field, operator, value: token.slice(field.length + operator.length) }
}
