"
I hold the small text helpers TapeDeck uses to build one-line summaries.

	TdText shorten: aLongString to: 60.
	TdText firstLine: 'a
b'.	""'a ...'""
"
Class {
	#name : 'TdText',
	#superclass : 'Object',
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'text' }
TdText class >> firstLine: aStringOrNil [
	"The first line, followed by ' ...' when more lines follow."

	| lines |
	aStringOrNil ifNil: [ ^ '' ].
	lines := aStringOrNil asString lines.
	lines isEmpty ifTrue: [ ^ '' ].
	^ lines size = 1
		  ifTrue: [ lines first ]
		  ifFalse: [ lines first , ' ...' ]
]

{ #category : 'text' }
TdText class >> oneLine: aStringOrNil max: anInteger [
	"The non-blank lines joined by spaces, at most anInteger characters."

	aStringOrNil ifNil: [ ^ '' ].
	^ self
		  shorten: (' ' join: ((aStringOrNil asString lines collect: [ :each | each trimBoth ]) reject: [ :each | each isEmpty ]))
		  to: anInteger
]

{ #category : 'text' }
TdText class >> shorten: aStringOrNil to: anInteger [
	"At most anInteger characters, ending with '...' when cut."

	| text |
	text := aStringOrNil ifNil: [ '' ] ifNotNil: [ aStringOrNil asString ].
	text size <= anInteger ifTrue: [ ^ text ].
	^ (text first: (anInteger - 3 max: 0)) , '...'
]
