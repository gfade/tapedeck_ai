"
I am a regular expression written in the JavaScript syntax of variant.json (INTERFACES.md §5.6), compiled with Pharo's regex engine. search: looks anywhere in a string, like RegExp.test; matchesWhole: must match all of it. Non-capturing groups (?:...) are read as plain groups; lookarounds and flags are not supported.

	(TdPattern source: '^npm (test|run test)') search: 'npm test'.	""true""
"
Class {
	#name : 'TdPattern',
	#superclass : 'Object',
	#instVars : [
		'source',
		'matcher'
	],
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'instance creation' }
TdPattern class >> source: aString [

	^ self new setSource: aString
]

{ #category : 'matching' }
TdPattern >> matchesWhole: aStringOrNil [

	aStringOrNil isString ifFalse: [ ^ false ].
	^ matcher matches: aStringOrNil
]

{ #category : 'private' }
TdPattern >> pharoSyntaxOf: aString [

	^ aString copyReplaceAll: '(?:' with: '('
]

{ #category : 'printing' }
TdPattern >> printOn: aStream [

	aStream
		nextPut: $/;
		nextPutAll: source;
		nextPut: $/
]

{ #category : 'matching' }
TdPattern >> search: aStringOrNil [
	"Whether the pattern matches somewhere in the string."

	aStringOrNil isString ifFalse: [ ^ false ].
	^ matcher search: aStringOrNil
]

{ #category : 'initialization' }
TdPattern >> setSource: aString [

	source := aString.
	matcher := (self pharoSyntaxOf: aString) asRegex
]

{ #category : 'accessing' }
TdPattern >> source [

	^ source
]
