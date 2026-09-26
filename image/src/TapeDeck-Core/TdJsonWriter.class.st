"
I write plain objects as JSON: dictionaries (in their own key order, or sorted), other collections as arrays, strings and symbols, numbers, booleans and nil. Floats that are not finite are written as null; fractions as floats.

	String streamContents: [ :out | (TdJsonWriter on: out) pretty: true; nextPut: aDictionary ]

TdJson has the usual entry points, including the canonical form (sorted keys, no whitespace) used to compare values.
"
Class {
	#name : 'TdJsonWriter',
	#superclass : 'Object',
	#instVars : [
		'stream',
		'pretty',
		'sortKeys',
		'level'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdJsonWriter class >> on: aWriteStream [

	^ self new setStream: aWriteStream
]

{ #category : 'private' }
TdJsonWriter >> indented: aBlock [

	level := level + 1.
	aBlock ensure: [ level := level - 1 ]
]

{ #category : 'private' }
TdJsonWriter >> keysOf: aDictionary [

	sortKeys ifFalse: [ ^ aDictionary keys ].
	^ aDictionary keys asSortedCollection: [ :a :b | a asString <= b asString ]
]

{ #category : 'private' }
TdJsonWriter >> newLine [

	pretty ifFalse: [ ^ self ].
	stream lf.
	level timesRepeat: [ stream nextPutAll: '  ' ]
]

{ #category : 'writing' }
TdJsonWriter >> nextPut: anObject [

	anObject ifNil: [ ^ stream nextPutAll: 'null' ].
	anObject == true ifTrue: [ ^ stream nextPutAll: 'true' ].
	anObject == false ifTrue: [ ^ stream nextPutAll: 'false' ].
	anObject isString ifTrue: [ ^ self writeString: anObject ].
	anObject isNumber ifTrue: [ ^ self writeNumber: anObject ].
	anObject isDictionary ifTrue: [ ^ self writeObject: anObject ].
	anObject isCollection ifTrue: [ ^ self writeArray: anObject ].
	^ TdJsonError signal: 'JSON: cannot write ' , anObject printString
]

{ #category : 'accessing' }
TdJsonWriter >> pretty: aBoolean [
	"Put each element on its own line, indented by two spaces per level."

	pretty := aBoolean
]

{ #category : 'initialization' }
TdJsonWriter >> setStream: aWriteStream [

	stream := aWriteStream.
	pretty := false.
	sortKeys := false.
	level := 0
]

{ #category : 'accessing' }
TdJsonWriter >> sortKeys: aBoolean [
	"Write object keys in sorted order (the canonical form)."

	sortKeys := aBoolean
]

{ #category : 'private' }
TdJsonWriter >> writeArray: aCollection [

	stream nextPut: $[.
	aCollection isEmpty ifTrue: [ ^ stream nextPut: $] ].
	self indented: [
		aCollection
			do: [ :each |
				self newLine.
				self nextPut: each ]
			separatedBy: [ stream nextPut: $, ] ].
	self newLine.
	stream nextPut: $]
]

{ #category : 'private' }
TdJsonWriter >> writeCharacter: aCharacter [

	| code |
	code := aCharacter asInteger.
	code = 34 ifTrue: [ ^ stream nextPutAll: '\"' ].
	code = 92 ifTrue: [ ^ stream nextPutAll: '\\' ].
	code >= 32 ifTrue: [ ^ stream nextPut: aCharacter ].
	code = 10 ifTrue: [ ^ stream nextPutAll: '\n' ].
	code = 13 ifTrue: [ ^ stream nextPutAll: '\r' ].
	code = 9 ifTrue: [ ^ stream nextPutAll: '\t' ].
	stream
		nextPutAll: '\u';
		nextPutAll: (code printStringBase: 16 length: 4 padded: true) asLowercase
]

{ #category : 'private' }
TdJsonWriter >> writeNumber: aNumber [

	aNumber isInteger ifTrue: [ ^ stream print: aNumber ].
	aNumber isFloat ifFalse: [ ^ self writeNumber: aNumber asFloat ].
	aNumber isFinite ifFalse: [ ^ stream nextPutAll: 'null' ].
	stream print: aNumber
]

{ #category : 'private' }
TdJsonWriter >> writeObject: aDictionary [

	stream nextPut: ${.
	aDictionary isEmpty ifTrue: [ ^ stream nextPut: $} ].
	self indented: [
		(self keysOf: aDictionary)
			do: [ :key |
				self newLine.
				self writeString: key asString.
				stream nextPut: $:.
				pretty ifTrue: [ stream space ].
				self nextPut: (aDictionary at: key) ]
			separatedBy: [ stream nextPut: $, ] ].
	self newLine.
	stream nextPut: $}
]

{ #category : 'private' }
TdJsonWriter >> writeString: aString [

	stream nextPut: $".
	aString do: [ :each | self writeCharacter: each ].
	stream nextPut: $"
]
