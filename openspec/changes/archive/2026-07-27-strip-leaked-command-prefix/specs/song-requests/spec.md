## ADDED Requirements

### Requirement: Leaked Command Trigger Stripping
The Request Song effect SHALL strip a leaked command trigger from the front of a query, before
that query is examined for a track link and before it is normalized into field filters. A leaked
trigger is the **first** whitespace-delimited token when it consists of `!` followed by a letter
and then any number of letters or digits — `!sr`, `!songrequest`, `!request2`.

The rule SHALL be narrow in three specific ways. Only the first token SHALL be considered, because
a `!` later in a query belongs to the title. The character after the `!` SHALL be required to be a
letter, so that the artist `!!!` is not mistaken for a trigger. And the strip SHALL be abandoned
when no non-empty text would remain, so that a query consisting only of a trigger produces the
ordinary not-found outcome rather than an empty search.

The script SHALL NOT attempt to recognize which triggers the streamer has configured; it registers
no commands and is not told what invoked the effect, so this is a rule about shape only.

When a trigger is stripped, the script SHALL log the removal at `debug` alongside the query it
searched, so a surprising match can be traced to the text actually sent to Spotify.

#### Scenario: Trigger stripped before a filtered search
- **WHEN** the query is `!sr Walk The Dinosaur by Ninja Sex Party`
- **THEN** the search is issued with `q` equal to `track:"Walk The Dinosaur" artist:"Ninja Sex Party"`
- **AND** the `!sr` appears in no request to Spotify

#### Scenario: Trigger stripped before a link is recognized
- **WHEN** the query is `!sr https://open.spotify.com/track/1O9XsjLUaxsYCRh9vyF8xS`
- **THEN** the track is resolved by direct lookup of that id
- **AND** no search is issued

#### Scenario: Only the leading token is stripped
- **WHEN** the query is `Hello! by Someone` or `Panic! At The Disco`
- **THEN** nothing is stripped, because the `!` is not at the front of the query

#### Scenario: The artist "!!!" is not a trigger
- **WHEN** the query is `!!! - Louden Up Now`
- **THEN** nothing is stripped, because the character after the leading `!` is not a letter
- **AND** the query is normalized exactly as it would have been before

#### Scenario: A query that is only a trigger is left alone
- **WHEN** the query is `!sr`
- **THEN** nothing is stripped, because no text would remain
- **AND** the request resolves as not found

#### Scenario: The strip is traceable
- **WHEN** a trigger is stripped from a query
- **THEN** a record is logged at `debug` naming what was stripped and the query that was searched
