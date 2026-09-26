"
I deny tool calls that touch a path matching my pattern (variant.json policy.denyPaths), like the runner's gate (runner/harness/variant.ts): the path argument of read, edit, write and other file tools, and any word of a bash command, so 'cat .env' and 'source ./.env' are caught too. Commands are split roughly into words: whitespace, separators and redirections split, quotes around a word are dropped.

	(TdDenyPathRule pattern: '(^|/)\.env$') denies: aToolCall
"
Class {
	#name : 'TdDenyPathRule',
	#superclass : 'TdPolicyRule',
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'accessing' }
TdDenyPathRule class >> wordSeparators [

	^ String withAll: {
			  Character space.
			  Character tab.
			  Character lf.
			  Character cr.
			  Character newPage.
			  $;.
			  $&.
			  $|.
			  $(.
			  $).
			  $<.
			  $>.
			  $` }
]

{ #category : 'accessing' }
TdDenyPathRule >> commandWordsOf: aCommand [
	"A shell command split roughly into words."

	aCommand isString ifFalse: [ ^ #(  ) ].
	^ ((aCommand substrings: self class wordSeparators) collect: [ :each | self withoutQuotes: each ])
		  reject: [ :each | each isEmpty ]
]

{ #category : 'testing' }
TdDenyPathRule >> denies: aToolCall [

	aToolCall isBash ifTrue: [
		^ (self commandWordsOf: aToolCall command) anySatisfy: [ :each | pattern search: each ] ].
	^ pattern search: aToolCall path
]

{ #category : 'private' }
TdDenyPathRule >> isQuote: aCharacter [

	^ aCharacter = $' or: [ aCharacter = $" ]
]

{ #category : 'accessing' }
TdDenyPathRule >> kindName [

	^ 'denyPaths'
]

{ #category : 'private' }
TdDenyPathRule >> withoutQuotes: aWord [

	| first last |
	first := aWord findFirst: [ :each | (self isQuote: each) not ].
	first = 0 ifTrue: [ ^ '' ].
	last := aWord findLast: [ :each | (self isQuote: each) not ].
	^ aWord copyFrom: first to: last
]
