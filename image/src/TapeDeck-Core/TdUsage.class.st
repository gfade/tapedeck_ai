"
I am the token and dollar usage of a model response, of a run, or a sum of them. I read both shapes TapeDeck meets: pi's usage, where cost is an object with a total, and run.json's, where cost is a number (INTERFACES.md §2.7, §5.2). Usages add with +.

	(TdUsage fromDictionary: runJson usage) + (TdUsage fromDictionary: otherRunJson usage).
	aUsage totalTokens.
	aUsage cost.	""dollars""
"
Class {
	#name : 'TdUsage',
	#superclass : 'Object',
	#instVars : [
		'input',
		'output',
		'cacheRead',
		'cacheWrite',
		'totalTokens',
		'cost'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdUsage class >> fromDictionary: aDictionaryOrNil [

	^ aDictionaryOrNil isDictionary
		  ifTrue: [ self new setFromDictionary: aDictionaryOrNil ]
		  ifFalse: [ self zero ]
]

{ #category : 'instance creation' }
TdUsage class >> input: inputTokens output: outputTokens cost: dollars [

	^ self new
		  setInput: inputTokens
		  output: outputTokens
		  cacheRead: 0
		  cacheWrite: 0
		  totalTokens: inputTokens + outputTokens
		  cost: dollars
]

{ #category : 'rounding' }
TdUsage class >> roundCost: aNumber [
	"Round dollars to 8 decimals, so sums of floats print cleanly."

	aNumber isInteger ifTrue: [ ^ aNumber ].
	^ ((aNumber * 100000000) rounded / 100000000) asFloat
]

{ #category : 'instance creation' }
TdUsage class >> sumOf: aCollectionOfUsages [

	^ aCollectionOfUsages inject: self zero into: [ :sum :each | sum + each ]
]

{ #category : 'instance creation' }
TdUsage class >> zero [

	^ self new
]

{ #category : 'arithmetic' }
TdUsage >> + aUsage [

	^ self class new
		  setInput: input + aUsage input
		  output: output + aUsage output
		  cacheRead: cacheRead + aUsage cacheRead
		  cacheWrite: cacheWrite + aUsage cacheWrite
		  totalTokens: totalTokens + aUsage totalTokens
		  cost: cost + aUsage cost
]

{ #category : 'comparing' }
TdUsage >> = anObject [

	self == anObject ifTrue: [ ^ true ].
	self class = anObject class ifFalse: [ ^ false ].
	^ input = anObject input and: [
		  output = anObject output and: [
			  cacheRead = anObject cacheRead and: [
				  cacheWrite = anObject cacheWrite and: [
					  totalTokens = anObject totalTokens and: [ self roundedCost = anObject roundedCost ] ] ] ] ]
]

{ #category : 'converting' }
TdUsage >> asDictionary [
	"The run.json shape: cost is a number of dollars."

	^ OrderedDictionary new
		  at: 'input' put: input;
		  at: 'output' put: output;
		  at: 'cacheRead' put: cacheRead;
		  at: 'cacheWrite' put: cacheWrite;
		  at: 'totalTokens' put: totalTokens;
		  at: 'cost' put: self roundedCost;
		  yourself
]

{ #category : 'accessing' }
TdUsage >> cacheRead [

	^ cacheRead
]

{ #category : 'accessing' }
TdUsage >> cacheWrite [

	^ cacheWrite
]

{ #category : 'accessing' }
TdUsage >> cost [
	"Dollars."

	^ cost
]

{ #category : 'private' }
TdUsage >> costIn: aDictionary [
	"run.json has a number; pi's usage has an object with a total."

	| value |
	value := aDictionary at: 'cost' ifAbsent: [ 0 ].
	value isNumber ifTrue: [ ^ value ].
	value isDictionary ifTrue: [ ^ self numberAt: 'total' in: value ].
	^ 0
]

{ #category : 'printing' }
TdUsage >> costString [

	^ '$' , (cost printShowingDecimalPlaces: 4)
]

{ #category : 'comparing' }
TdUsage >> hash [

	^ totalTokens hash bitXor: input hash
]

{ #category : 'initialization' }
TdUsage >> initialize [

	super initialize.
	input := 0.
	output := 0.
	cacheRead := 0.
	cacheWrite := 0.
	totalTokens := 0.
	cost := 0
]

{ #category : 'accessing' }
TdUsage >> input [

	^ input
]

{ #category : 'testing' }
TdUsage >> isZero [

	^ totalTokens = 0 and: [ cost = 0 ]
]

{ #category : 'private' }
TdUsage >> numberAt: aKey in: aDictionary [

	| value |
	value := aDictionary at: aKey ifAbsent: [ 0 ].
	^ value isNumber
		  ifTrue: [ value ]
		  ifFalse: [ 0 ]
]

{ #category : 'accessing' }
TdUsage >> output [

	^ output
]

{ #category : 'printing' }
TdUsage >> printOn: aStream [

	aStream
		print: totalTokens;
		nextPutAll: ' tokens, ';
		nextPutAll: self costString
]

{ #category : 'accessing' }
TdUsage >> roundedCost [

	^ self class roundCost: cost
]

{ #category : 'initialization' }
TdUsage >> setFromDictionary: aDictionary [

	input := self numberAt: 'input' in: aDictionary.
	output := self numberAt: 'output' in: aDictionary.
	cacheRead := self numberAt: 'cacheRead' in: aDictionary.
	cacheWrite := self numberAt: 'cacheWrite' in: aDictionary.
	totalTokens := (aDictionary at: 'totalTokens' ifAbsent: [ nil ]) ifNil: [
		               input + output + cacheRead + cacheWrite ].
	cost := self costIn: aDictionary
]

{ #category : 'initialization' }
TdUsage >> setInput: inputTokens output: outputTokens cacheRead: cacheReadTokens cacheWrite: cacheWriteTokens totalTokens: allTokens cost: dollars [

	input := inputTokens.
	output := outputTokens.
	cacheRead := cacheReadTokens.
	cacheWrite := cacheWriteTokens.
	totalTokens := allTokens.
	cost := dollars
]

{ #category : 'accessing' }
TdUsage >> tokens [

	^ totalTokens
]

{ #category : 'accessing' }
TdUsage >> totalTokens [

	^ totalTokens
]
