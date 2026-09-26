"
I am a harness variant (variant.json, INTERFACES.md §5.6): prompt rules, a tool policy and a fork rule. I answer where a fork of a baseline should go live for me; my policy answers what I would have blocked.

	variant := TdVariant fromFile: 'runner/bench/variants/rule-taskrunner/variant.json'.
	variant forkStepFor: baselineRun.	""the first step whose response runs npm""
	variant policy blockedCallsIn: store.
	TdVariant named: 'vanilla'.
"
Class {
	#name : 'TdVariant',
	#superclass : 'Object',
	#instVars : [
		'name',
		'description',
		'rules',
		'policy',
		'forkRule',
		'definition'
	],
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'instance creation' }
TdVariant class >> fromDictionary: aDictionary [

	^ self new setFromDictionary: aDictionary
]

{ #category : 'instance creation' }
TdVariant class >> fromFile: aFileReferenceOrPath [

	^ self fromDictionary: (TdJson fromFile: aFileReferenceOrPath)
]

{ #category : 'instance creation' }
TdVariant class >> named: aString [
	"A variant with a name only: no rules, no policy, no fork rule."

	^ self fromDictionary: (OrderedDictionary new
			   at: 'name' put: aString;
			   yourself)
]

{ #category : 'converting' }
TdVariant >> asDictionary [
	"variant.json as read."

	^ definition
]

{ #category : 'what-if' }
TdVariant >> blockedCallsIn: aSource [
	"The recorded tool calls my policy would have blocked (see TdPolicy>>blockedCallsIn:)."

	^ policy blockedCallsIn: aSource
]

{ #category : 'accessing' }
TdVariant >> description [

	^ description
]

{ #category : 'accessing' }
TdVariant >> forkRule [
	"A TdForkRule, or nil."

	^ forkRule
]

{ #category : 'queries' }
TdVariant >> forkStepFor: aRun [
	"The step of aRun where a fork with me should go live (the first step whose response has a tool call matching my fork rule), or nil."

	^ forkRule ifNotNil: [ :rule | rule firstMatchingStepIn: aRun ]
]

{ #category : 'accessing' }
TdVariant >> lenient [
	"What a fork with me ignores before going live, e.g. #('system'); nil when I have no fork rule (the runner decides)."

	^ forkRule ifNotNil: [ :rule | rule lenient ]
]

{ #category : 'accessing' }
TdVariant >> name [

	^ name
]

{ #category : 'accessing' }
TdVariant >> policy [
	"A TdPolicy, possibly empty."

	^ policy
]

{ #category : 'printing' }
TdVariant >> printOn: aStream [

	aStream
		nextPutAll: 'TdVariant(';
		nextPutAll: name asString;
		nextPut: $)
]

{ #category : 'accessing' }
TdVariant >> rules [
	"The prompt rules, which the runner puts in a tapedeck-rules section."

	^ rules
]

{ #category : 'initialization' }
TdVariant >> setFromDictionary: aDictionary [

	definition := aDictionary.
	name := aDictionary at: 'name' ifAbsent: [ nil ].
	description := (aDictionary at: 'description' ifAbsent: [ nil ]) ifNil: [ '' ].
	rules := ((aDictionary at: 'rules' ifAbsent: [ nil ]) ifNil: [ #(  ) ]) asArray.
	policy := TdPolicy fromVariantDictionary: ((aDictionary at: 'policy' ifAbsent: [ nil ]) ifNil: [
			           OrderedDictionary new ]).
	forkRule := (aDictionary at: 'fork' ifAbsent: [ nil ]) ifNotNil: [ :fork |
		            fork isDictionary ifTrue: [ TdForkRule fromDictionary: fork ] ]
]
