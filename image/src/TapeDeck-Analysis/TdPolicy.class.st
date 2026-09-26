"
I am a tool policy: an ordered list of rules. Without calling any model, I answer which recorded tool calls I would have blocked: a what-if over everything the image holds. I read the policy of a variant.json (INTERFACES.md §5.6), command rules first, like the runner's gate.

	policy := TdPolicy new
		denyCommand: '^npm (test|run test)';
		denyPath: '(^|/)\.env$';
		yourself.
	policy blockedCallsIn: store.	""a run, a step, a store or a collection works too""
	policy reasonFor: aToolCall.
	policy firstBlockedCallIn: aRun.	""where a replay with this policy would diverge (tool-blocked)""
	TdPolicy fromVariantDictionary: (TdJson fromFile: 'runner/bench/variants/guard-secrets/variant.json').
"
Class {
	#name : 'TdPolicy',
	#superclass : 'Object',
	#instVars : [
		'rules'
	],
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'instance creation' }
TdPolicy class >> denyCommands: someCommandPatterns denyPaths: somePathPatterns [

	| policy |
	policy := self new.
	someCommandPatterns do: [ :each | policy denyCommand: each ].
	somePathPatterns do: [ :each | policy denyPath: each ].
	^ policy
]

{ #category : 'instance creation' }
TdPolicy class >> fromVariantDictionary: aDictionary [
	"Accept a whole variant.json or just its policy object {denyCommands, denyPaths}."

	| policy |
	policy := (aDictionary includesKey: 'policy')
		          ifTrue: [ aDictionary at: 'policy' ]
		          ifFalse: [ aDictionary ].
	^ self
		  denyCommands: (self patternsAt: 'denyCommands' in: policy)
		  denyPaths: (self patternsAt: 'denyPaths' in: policy)
]

{ #category : 'private' }
TdPolicy class >> patternsAt: aKey in: aDictionaryOrNil [

	aDictionaryOrNil isDictionary ifFalse: [ ^ #(  ) ].
	^ ((aDictionaryOrNil at: aKey ifAbsent: [ nil ]) ifNil: [ #(  ) ]) select: [ :each | each isString ]
]

{ #category : 'building' }
TdPolicy >> addRule: aRule [

	rules add: aRule.
	^ aRule
]

{ #category : 'testing' }
TdPolicy >> allows: aToolCall [

	^ (self ruleDenying: aToolCall) isNil
]

{ #category : 'converting' }
TdPolicy >> asDictionary [
	"The variant.json policy shape."

	^ OrderedDictionary new
		  at: 'denyCommands' put: ((rules select: [ :each | each kindName = 'denyCommands' ]) collect: [ :each | each source ]) asArray;
		  at: 'denyPaths' put: ((rules select: [ :each | each kindName = 'denyPaths' ]) collect: [ :each | each source ]) asArray;
		  yourself
]

{ #category : 'what-if' }
TdPolicy >> blockedCallsIn: aSource [
	"The recorded tool calls I would block. aSource is a tool call, a step, a run, a store, or a collection of those."

	^ (self toolCallsIn: aSource) select: [ :each | self denies: each ]
]

{ #category : 'testing' }
TdPolicy >> denies: aToolCall [

	^ (self allows: aToolCall) not
]

{ #category : 'building' }
TdPolicy >> denyCommand: aJavaScriptRegex [

	^ self addRule: (TdDenyCommandRule pattern: aJavaScriptRegex)
]

{ #category : 'building' }
TdPolicy >> denyPath: aJavaScriptRegex [

	^ self addRule: (TdDenyPathRule pattern: aJavaScriptRegex)
]

{ #category : 'what-if' }
TdPolicy >> firstBlockedCallIn: aRun [
	"The first call of aRun I would block: where a replay with me would diverge (tool-blocked). nil if none."

	^ (self toolCallsIn: aRun) detect: [ :each | self denies: each ] ifNone: [ nil ]
]

{ #category : 'initialization' }
TdPolicy >> initialize [

	super initialize.
	rules := OrderedCollection new
]

{ #category : 'testing' }
TdPolicy >> isEmpty [

	^ rules isEmpty
]

{ #category : 'printing' }
TdPolicy >> printOn: aStream [

	aStream nextPutAll: 'TdPolicy('.
	rules
		do: [ :each | aStream nextPutAll: each label ]
		separatedBy: [ aStream nextPutAll: '; ' ].
	aStream nextPut: $)
]

{ #category : 'what-if' }
TdPolicy >> reasonFor: aToolCall [
	"'Blocked by tapedeck policy: <rule>' if I deny aToolCall, else nil."

	^ (self ruleDenying: aToolCall) ifNotNil: [ :rule | rule reason ]
]

{ #category : 'what-if' }
TdPolicy >> ruleDenying: aToolCall [
	"The first of my rules that denies aToolCall, or nil."

	^ rules detect: [ :each | each denies: aToolCall ] ifNone: [ nil ]
]

{ #category : 'accessing' }
TdPolicy >> rules [

	^ rules asArray
]

{ #category : 'private' }
TdPolicy >> toolCallsIn: aSource [

	^ aSource isCollection
		  ifTrue: [ aSource flatCollect: [ :each | each toolCalls ] ]
		  ifFalse: [ aSource toolCalls ]
]
