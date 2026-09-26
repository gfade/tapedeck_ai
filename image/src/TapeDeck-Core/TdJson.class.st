"
I am the entry point for JSON in TapeDeck: reading (object key order is kept), writing (compact, pretty or canonical) and a few helpers on plain JSON values (Dictionary, Array, String, Number, Boolean, nil).

	TdJson fromString: '{""a"":1}'.
	TdJson fromFile: '/abs/store/runs/<id>/run.json'.
	TdJson linesFromString: aJsonLinesString.
	TdJson toString: aValue.
	TdJson toStringPretty: aValue.
	TdJson toCanonicalString: aValue.	""sorted keys, no whitespace""
	TdJson is: aValue equalTo: anotherValue.
"
Class {
	#name : 'TdJson',
	#superclass : 'Object',
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'copying' }
TdJson class >> copy: aValue [
	"A deep copy of a JSON value; dictionaries become OrderedDictionary and lists Array."

	aValue isString ifTrue: [ ^ aValue copy ].
	aValue isDictionary ifTrue: [
		| copy |
		copy := OrderedDictionary new.
		aValue keysAndValuesDo: [ :key :value | copy at: key put: (self copy: value) ].
		^ copy ].
	aValue isCollection ifTrue: [ ^ aValue asArray collect: [ :each | self copy: each ] ].
	^ aValue
]

{ #category : 'reading' }
TdJson class >> fromFile: aFileReference [

	^ self fromString: aFileReference asFileReference contents
]

{ #category : 'reading' }
TdJson class >> fromString: aString [

	| reader value |
	reader := TdJsonReader on: aString readStream.
	value := reader next.
	reader atEnd ifFalse: [ TdJsonError signal: 'JSON: unexpected text after the value' ].
	^ value
]

{ #category : 'comparing' }
TdJson class >> is: aValue equalTo: anotherValue [

	^ (self toCanonicalString: aValue) = (self toCanonicalString: anotherValue)
]

{ #category : 'reading' }
TdJson class >> linesFromString: aString [
	"Read JSON Lines: one value per non-blank line."

	^ (aString lines reject: [ :each | each isAllSeparators ]) collect: [ :each |
		  self fromString: each ]
]

{ #category : 'copying' }
TdJson class >> replace: aString with: aReplacement in: aValue [
	"A deep copy of aValue in which every string has aString replaced by aReplacement."

	aString isEmptyOrNil ifTrue: [ ^ self copy: aValue ].
	aValue isString ifTrue: [ ^ aValue asString copyReplaceAll: aString with: aReplacement ].
	aValue isDictionary ifTrue: [
		| copy |
		copy := OrderedDictionary new.
		aValue keysAndValuesDo: [ :key :value |
			copy at: key put: (self replace: aString with: aReplacement in: value) ].
		^ copy ].
	aValue isCollection ifTrue: [
		^ aValue asArray collect: [ :each | self replace: aString with: aReplacement in: each ] ].
	^ aValue
]

{ #category : 'writing' }
TdJson class >> toCanonicalString: aValue [
	"Sorted keys and no whitespace: equal values give equal strings."

	^ String streamContents: [ :out |
		  (TdJsonWriter on: out)
			  sortKeys: true;
			  nextPut: aValue ]
]

{ #category : 'writing' }
TdJson class >> toString: aValue [

	^ String streamContents: [ :out | (TdJsonWriter on: out) nextPut: aValue ]
]

{ #category : 'writing' }
TdJson class >> toStringPretty: aValue [

	^ String streamContents: [ :out |
		  (TdJsonWriter on: out)
			  pretty: true;
			  nextPut: aValue ]
]
