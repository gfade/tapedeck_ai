"
I say where a fork of a baseline tape goes live for a variant (variant.json fork, INTERFACES.md §5.6): at the first step whose response has a tool call matching my tool pattern (matched against the whole tool name, so 'edit|write' works) and all my argument patterns (searched in the argument as a string). lenient lists what the fork ignores before that point; only 'system' is defined.

	rule := TdForkRule fromDictionary: variantJson fork.
	rule firstMatchingStepIn: baselineRun.
"
Class {
	#name : 'TdForkRule',
	#superclass : 'Object',
	#instVars : [
		'toolPattern',
		'argumentPatterns',
		'lenient'
	],
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'instance creation' }
TdForkRule class >> fromDictionary: aForkDictionary [
	"{lenient, at: {tool, argMatches}}"

	^ self new
		  setLenient: ((aForkDictionary at: 'lenient' ifAbsent: [ nil ]) ifNil: [ #(  ) ])
		  target: (aForkDictionary at: 'at' ifAbsent: [ nil ])
]

{ #category : 'private' }
TdForkRule >> argument: aName of: aToolCall [
	"The argument as a string: strings as they are, numbers printed, other values as JSON."

	| value |
	value := aToolCall argumentAt: aName.
	value ifNil: [ ^ nil ].
	value isString ifTrue: [ ^ value ].
	value isNumber ifTrue: [ ^ value printString ].
	^ TdJson toString: value
]

{ #category : 'converting' }
TdForkRule >> asDictionary [

	| at arguments |
	arguments := OrderedDictionary new.
	argumentPatterns keysAndValuesDo: [ :name :pattern | arguments at: name put: pattern source ].
	at := OrderedDictionary new.
	toolPattern ifNotNil: [ at at: 'tool' put: toolPattern source ].
	at at: 'argMatches' put: arguments.
	^ OrderedDictionary new
		  at: 'lenient' put: lenient;
		  at: 'at' put: at;
		  yourself
]

{ #category : 'queries' }
TdForkRule >> firstMatchingStepIn: aRun [
	"The first step whose response has a matching tool call, or nil."

	^ aRun steps
		  detect: [ :step | step response notNil and: [ step response toolCalls anySatisfy: [ :each | self matches: each ] ] ]
		  ifNone: [ nil ]
]

{ #category : 'testing' }
TdForkRule >> hasTarget [
	"Whether I name a tool call to fork at; without one, a fork relies on natural divergence."

	^ toolPattern notNil or: [ argumentPatterns notEmpty ]
]

{ #category : 'accessing' }
TdForkRule >> lenient [

	^ lenient
]

{ #category : 'testing' }
TdForkRule >> matches: aToolCall [

	self hasTarget ifFalse: [ ^ false ].
	(toolPattern isNil or: [ toolPattern matchesWhole: aToolCall name ]) ifFalse: [ ^ false ].
	^ argumentPatterns associations allSatisfy: [ :each |
		  each value search: (self argument: each key of: aToolCall) ]
]

{ #category : 'printing' }
TdForkRule >> printOn: aStream [

	aStream nextPutAll: 'TdForkRule('.
	toolPattern ifNotNil: [ aStream print: toolPattern ].
	argumentPatterns keysAndValuesDo: [ :name :pattern |
		aStream
			space;
			nextPutAll: name;
			nextPutAll: ' ~ ';
			print: pattern ].
	aStream nextPut: $)
]

{ #category : 'initialization' }
TdForkRule >> setLenient: aCollection target: anAtDictionaryOrNil [

	lenient := aCollection asArray.
	argumentPatterns := OrderedDictionary new.
	anAtDictionaryOrNil isDictionary ifFalse: [ ^ self ].
	toolPattern := (anAtDictionaryOrNil at: 'tool' ifAbsent: [ nil ]) ifNotNil: [ :source |
		               TdPattern source: source ].
	((anAtDictionaryOrNil at: 'argMatches' ifAbsent: [ nil ]) ifNil: [ OrderedDictionary new ])
		keysAndValuesDo: [ :name :source | argumentPatterns at: name put: (TdPattern source: source) ]
]
