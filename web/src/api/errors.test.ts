/**
 * What a failed request says to a person.
 *
 * A 403 from the API arrives as `{"message":"...","error":"Forbidden","statusCode":403}`,
 * and that whole line was being shown to HR above the form. Only `message` is written
 * for a reader; the rest is for a log.
 */

import { describe, expect, it } from 'vitest'
import { messageIn } from './client'

describe('the message inside a failure', () => {
  it('takes the sentence out of a NestJS body', () => {
    expect(
      messageIn('{"message":"This action requires the HR role.","error":"Forbidden","statusCode":403}', 403),
    ).toBe('This action requires the HR role.')
  })

  it('joins a list of validation failures', () => {
    // `message` is an array when several fields fail at once.
    expect(messageIn('{"message":["name should not be empty","isoDate must be a date"]}', 422)).toBe(
      'name should not be empty. isoDate must be a date',
    )
  })

  it('falls back to the error name when there is no message', () => {
    expect(messageIn('{"error":"Forbidden","statusCode":403}', 403)).toBe('Forbidden')
  })

  it('shows a non-JSON body as it came', () => {
    // An HTML error page or a proxy's plain text is still the best evidence there is.
    expect(messageIn('Bad Gateway', 502)).toBe('Bad Gateway')
  })

  it('names the status when the body is empty', () => {
    expect(messageIn('', 500)).toBe('Request failed (500)')
    expect(messageIn('   ', 500)).toBe('Request failed (500)')
  })
})
