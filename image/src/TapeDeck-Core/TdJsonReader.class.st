"
I read JSON text into plain objects. Objects become OrderedDictionary, so key order is kept (prompt sections are ordered objects in pi sessions); arrays become Array, strings String, numbers Integer or Float, true and false Boolean, and null nil.

	(TdJsonReader on: '{""b"":1,""a"":[true,null]}' readStream) next

TdJson is the usual entry point.
"
Class {
	#name : 'TdJsonReader',
	#superclass : 'Object',
	#instVars : [
		'stream'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdJsonReader class >> on: aReadStream [

	^ self new setStream: aReadStream
]

{ #category : 'reading' }
TdJsonReader >> atEnd [
	"Answer whether only whitespace is left."

	self skipWhitespace.
	^ stream atEnd
]

{ #category : 'private' }
TdJsonReader >> consume: aCharacter [
	"Skip whitespace; if aCharacter comes next, consume it and answer true."

	self skipWhitespace.
	^ stream peekFor: aCharacter
]

{ #category : 'private' }
TdJsonReader >> expect: aCharacter [

	(self consume: aCharacter) ifFalse: [ self fail: 'expected ' , aCharacter printString ]
]

{ #category : 'private' }
TdJsonReader >> fail: aString [

	^ TdJsonError signal: 'JSON: ' , aString , ' at position ' , stream position printString
]

{ #category : 'private' }
TdJsonReader >> floatFromMantissa: anInteger exponent: anExponent [
	"Exact decimal to binary conversion: the Fraction is rounded once by asFloat."

	^ anExponent >= 0
		ifTrue: [ (anInteger * (10 raisedTo: anExponent)) asFloat ]
		ifFalse: [ (anInteger / (10 raisedTo: anExponent negated)) asFloat ]
]

{ #category : 'private' }
TdJsonReader >> matchWord: aString [
	"Consume aString if it comes next."

	| start |
	start := stream position.
	(stream next: aString size) = aString ifTrue: [ ^ true ].
	stream position: start.
	^ false
]

{ #category : 'reading' }
TdJsonReader >> next [
	"Read the next JSON value."

	^ self readValue
]

{ #category : 'private' }
TdJsonReader >> readArray [

	| elements |
	elements := OrderedCollection new.
	self expect: $[.
	(self consume: $]) ifTrue: [ ^ elements asArray ].
	[
	elements add: self readValue.
	self consume: $, ] whileTrue.
	self expect: $].
	^ elements asArray
]

{ #category : 'private' }
TdJsonReader >> readEscapeOnto: aWriteStream [

	| character |
	stream atEnd ifTrue: [ self fail: 'unterminated escape' ].
	character := stream next.
	character = $u ifTrue: [ ^ aWriteStream nextPut: self readUnicodeEscape ].
	aWriteStream nextPut: (self unescaped: character)
]

{ #category : 'private' }
TdJsonReader >> readExponent [

	| negative |
	negative := false.
	(stream peekFor: $+) ifFalse: [ negative := stream peekFor: $- ].
	^ negative
		  ifTrue: [ self readUnsignedInteger negated ]
		  ifFalse: [ self readUnsignedInteger ]
]

{ #category : 'private' }
TdJsonReader >> readHexQuad [

	| value |
	value := 0.
	4 timesRepeat: [
		| digit |
		stream atEnd ifTrue: [ self fail: 'incomplete \u escape' ].
		digit := stream next digitValue.
		(digit between: 0 and: 15) ifFalse: [ self fail: 'invalid \u escape' ].
		value := value * 16 + digit ].
	^ value
]

{ #category : 'private' }
TdJsonReader >> readNumber [

	| negative integer fraction scale exponent value |
	negative := stream peekFor: $-.
	integer := self readUnsignedInteger.
	fraction := 0.
	scale := 0.
	exponent := nil.
	(stream peekFor: $.) ifTrue: [
		[ stream atEnd not and: [ stream peek isDigit ] ] whileTrue: [
			fraction := fraction * 10 + stream next digitValue.
			scale := scale + 1 ].
		scale = 0 ifTrue: [ self fail: 'digit expected after the decimal point' ] ].
	((stream peekFor: $e) or: [ stream peekFor: $E ]) ifTrue: [ exponent := self readExponent ].
	value := (scale = 0 and: [ exponent isNil ])
		         ifTrue: [ integer ]
		         ifFalse: [
			         self
				         floatFromMantissa: integer * (10 raisedTo: scale) + fraction
				         exponent: (exponent ifNil: [ 0 ]) - scale ].
	^ negative
		  ifTrue: [ value negated ]
		  ifFalse: [ value ]
]

{ #category : 'private' }
TdJsonReader >> readObject [

	| object |
	object := OrderedDictionary new.
	self expect: ${.
	(self consume: $}) ifTrue: [ ^ object ].
	[
	| key |
	key := self readString.
	self expect: $:.
	object at: key put: self readValue.
	self consume: $, ] whileTrue.
	self expect: $}.
	^ object
]

{ #category : 'private' }
TdJsonReader >> readString [

	| buffer character |
	self expect: $".
	buffer := WriteStream on: (String new: 16).
	[
	stream atEnd ifTrue: [ self fail: 'unterminated string' ].
	(character := stream next) = $" ] whileFalse: [
		character = $\
			ifTrue: [ self readEscapeOnto: buffer ]
			ifFalse: [ buffer nextPut: character ] ].
	^ buffer contents
]

{ #category : 'private' }
TdJsonReader >> readUnicodeEscape [
	"Read the four hex digits after \u, combining a UTF-16 surrogate pair into one character."

	| high low |
	high := self readHexQuad.
	(high between: 16rD800 and: 16rDBFF) ifFalse: [ ^ Character value: high ].
	(self matchWord: '\u') ifFalse: [ ^ Character value: 16rFFFD ].
	low := self readHexQuad.
	(low between: 16rDC00 and: 16rDFFF) ifFalse: [ ^ Character value: 16rFFFD ].
	^ Character value: (high - 16rD800 bitShift: 10) + (low - 16rDC00) + 16r10000
]

{ #category : 'private' }
TdJsonReader >> readUnsignedInteger [

	| value |
	(stream atEnd not and: [ stream peek isDigit ]) ifFalse: [ self fail: 'digit expected' ].
	value := 0.
	[ stream atEnd not and: [ stream peek isDigit ] ] whileTrue: [
		value := value * 10 + stream next digitValue ].
	^ value
]

{ #category : 'private' }
TdJsonReader >> readValue [

	| character |
	self skipWhitespace.
	stream atEnd ifTrue: [ ^ self fail: 'value expected' ].
	character := stream peek.
	character = ${ ifTrue: [ ^ self readObject ].
	character = $[ ifTrue: [ ^ self readArray ].
	character = $" ifTrue: [ ^ self readString ].
	(character = $- or: [ character isDigit ]) ifTrue: [ ^ self readNumber ].
	(self matchWord: 'true') ifTrue: [ ^ true ].
	(self matchWord: 'false') ifTrue: [ ^ false ].
	(self matchWord: 'null') ifTrue: [ ^ nil ].
	^ self fail: 'unexpected ' , character printString
]

{ #category : 'initialization' }
TdJsonReader >> setStream: aReadStream [

	stream := aReadStream
]

{ #category : 'private' }
TdJsonReader >> skipWhitespace [

	[ stream atEnd not and: [ stream peek isSeparator ] ] whileTrue: [ stream next ]
]

{ #category : 'private' }
TdJsonReader >> unescaped: aCharacter [

	aCharacter = $n ifTrue: [ ^ Character lf ].
	aCharacter = $t ifTrue: [ ^ Character tab ].
	aCharacter = $r ifTrue: [ ^ Character cr ].
	aCharacter = $b ifTrue: [ ^ Character backspace ].
	aCharacter = $f ifTrue: [ ^ Character newPage ].
	('"\/' includes: aCharacter) ifTrue: [ ^ aCharacter ].
	^ self fail: 'invalid escape \' , aCharacter asString
]
