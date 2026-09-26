"
I line up two runs step by step and find the first step whose normalized request or response differs, with a readable reason. Use me to see where a fork left its baseline, or whether a fork and a full rerun behaved the same.

	(TdAlignment of: baseline with: fork) lenient: #( 'system' ); reason.
	(TdAlignment of: fork with: rerun) isIdentical.

Requests are pi-tape's normalized requests, where the working directory is already <cwd>. Responses are compared by content (text, thinking, tool calls), with each run's working directory written as <cwd>. Tool-call ids are replaced by their position (call-<step>.<n>) unless ignoreIds is false, so live runs whose model makes up ids still line up. lenient: #('system') drops system messages before comparing requests, like PI_TAPE_LENIENT=system; then a difference in the harness alone is not a difference.
"
Class {
	#name : 'TdAlignment',
	#superclass : 'Object',
	#instVars : [
		'left',
		'right',
		'lenient',
		'ignoreIds',
		'difference',
		'computed',
		'idMaps'
	],
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'instance creation' }
TdAlignment class >> of: aRun with: anotherRun [

	^ self new setLeft: aRun right: anotherRun
]

{ #category : 'private' }
TdAlignment >> comparable: aJsonValue in: aRun [

	ignoreIds ifFalse: [ ^ aJsonValue ].
	^ self rename: aJsonValue with: (self idMapFor: aRun)
]

{ #category : 'private' }
TdAlignment >> comparableRequestOf: aStep in: aRun [
	"message -> comparable value, for the messages that count."

	^ ((aStep request reject: [ :each | self ignores: each ]) collect: [ :each |
		   each -> (self comparable: each asDictionary in: aRun) ]) asArray
]

{ #category : 'private' }
TdAlignment >> comparableResponseOf: aStep in: aRun [

	aStep response ifNil: [ ^ nil ].
	^ self comparable: (aRun normalizeCwdIn: (self normalizedResponse: aStep response)) in: aRun
]

{ #category : 'private' }
TdAlignment >> computeFirstDifference [

	1 to: self stepCount do: [ :index |
		(self differenceAtStep: index) ifNotNil: [ :found | ^ found ] ].
	^ nil
]

{ #category : 'private' }
TdAlignment >> differenceAtStep: anIndex [

	| a b |
	a := left stepAt: anIndex.
	b := right stepAt: anIndex.
	(a isNil or: [ b isNil ]) ifTrue: [ ^ self missingStep: anIndex ].
	^ (self requestDifferenceBetween: a and: b) ifNil: [ self responseDifferenceBetween: a and: b ]
]

{ #category : 'queries' }
TdAlignment >> divergenceStep [
	"The first step that differs, or nil."

	^ self firstDifference ifNotNil: [ :found | found step ]
]

{ #category : 'queries' }
TdAlignment >> firstDifference [
	"A TdStepDifference, or nil when the runs are the same step for step."

	computed ifFalse: [
		difference := self computeFirstDifference.
		computed := true ].
	^ difference
]

{ #category : 'private' }
TdAlignment >> firstDifferingIndexOf: aList and: anotherList [
	"1-based index of the first pair that differs, or nil."

	1 to: (aList size max: anotherList size) do: [ :index |
		(index > aList size or: [ index > anotherList size ]) ifTrue: [ ^ index ].
		(TdJson is: (aList at: index) value equalTo: (anotherList at: index) value) ifFalse: [ ^ index ] ].
	^ nil
]

{ #category : 'private' }
TdAlignment >> harnessDescriptionFrom: aSystemMessage to: anotherSystemMessage [

	^ ((TdHarnessState fromMessages: { aSystemMessage }) diff:
		   (TdHarnessState fromMessages: { anotherSystemMessage })) description
]

{ #category : 'private' }
TdAlignment >> idMapFor: aRun [
	"Tool-call id -> position name (call-<step>.<n>), for the calls in aRun's responses."

	idMaps ifNil: [ idMaps := IdentityDictionary new ].
	^ idMaps at: aRun ifAbsentPut: [
		  | map |
		  map := Dictionary new.
		  aRun steps do: [ :step |
			  step response ifNotNil: [ :response |
				  response toolCalls withIndexDo: [ :call :position |
					  call id ifNotNil: [ :callId |
						  map at: callId ifAbsentPut: [ 'call-' , step index printString , '.' , position printString ] ] ] ] ].
		  map ]
]

{ #category : 'accessing' }
TdAlignment >> ignoreIds: aBoolean [

	ignoreIds := aBoolean.
	self reset
]

{ #category : 'private' }
TdAlignment >> ignores: aMessage [

	^ (lenient includes: 'system') and: [ aMessage isSystem ]
]

{ #category : 'queries' }
TdAlignment >> isIdentical [

	^ self firstDifference isNil
]

{ #category : 'accessing' }
TdAlignment >> left [

	^ left
]

{ #category : 'accessing' }
TdAlignment >> lenient [

	^ lenient
]

{ #category : 'accessing' }
TdAlignment >> lenient: aCollectionOfStrings [
	"#('system') ignores differences in system messages (prompt sections and tools)."

	lenient := aCollectionOfStrings asArray.
	self reset
]

{ #category : 'private' }
TdAlignment >> missingStep: anIndex [

	^ TdStepDifference
		  step: anIndex
		  part: #missing
		  reason: ('step {1}: only one run has it ({2} has {3} steps, {4} has {5})' format: {
					   anIndex.
					   left id.
					   left stepCount.
					   right id.
					   right stepCount })
]

{ #category : 'private' }
TdAlignment >> normalizedBlock: aBlock [

	| type |
	type := aBlock at: 'type' ifAbsent: [ nil ].
	type = 'text' ifTrue: [ ^ self select: #( 'type' 'text' ) from: aBlock ].
	type = 'thinking' ifTrue: [ ^ self select: #( 'type' 'thinking' 'redacted' ) from: aBlock ].
	type = 'toolCall' ifTrue: [ ^ self select: #( 'type' 'id' 'name' 'arguments' ) from: aBlock ].
	^ aBlock
]

{ #category : 'private' }
TdAlignment >> normalizedResponse: aMessage [
	"The response as pi-tape normalizes an assistant message: role and content blocks, without signatures, usage, ids or timestamps."

	^ OrderedDictionary new
		  at: 'role' put: aMessage role;
		  at: 'content' put: (aMessage blocks collect: [ :each | self normalizedBlock: each ]);
		  yourself
]

{ #category : 'printing' }
TdAlignment >> printOn: aStream [

	aStream
		nextPutAll: 'TdAlignment(';
		nextPutAll: self reason;
		nextPut: $)
]

{ #category : 'queries' }
TdAlignment >> reason [

	^ self firstDifference
		  ifNil: [ 'no difference in ' , self stepCount printString , ' steps' ]
		  ifNotNil: [ :found | found reason ]
]

{ #category : 'private' }
TdAlignment >> rename: aJsonValue with: anIdMap [

	aJsonValue isString ifTrue: [ ^ anIdMap at: aJsonValue ifAbsent: [ aJsonValue ] ].
	aJsonValue isDictionary ifTrue: [
		| copy |
		copy := OrderedDictionary new.
		aJsonValue keysAndValuesDo: [ :key :value | copy at: key put: (self rename: value with: anIdMap) ].
		^ copy ].
	aJsonValue isCollection ifTrue: [ ^ aJsonValue asArray collect: [ :each | self rename: each with: anIdMap ] ].
	^ aJsonValue
]

{ #category : 'private' }
TdAlignment >> requestDifferenceAt: aStepIndex position: aPosition left: aList right: anotherList [

	| a b diff |
	a := aList at: aPosition ifAbsent: [ nil ].
	b := anotherList at: aPosition ifAbsent: [ nil ].
	diff := TdJsonDiff between: (a ifNotNil: [ a value ]) and: (b ifNotNil: [ b value ]).
	^ (TdStepDifference
		   step: aStepIndex
		   part: #request
		   reason: (self requestReasonAt: aStepIndex index: aPosition - 1 left: a right: b diff: diff))
		  messageIndex: aPosition - 1;
		  diff: diff;
		  yourself
]

{ #category : 'private' }
TdAlignment >> requestDifferenceBetween: aStep and: anotherStep [

	| requestA requestB position |
	(aStep hasRequest and: [ anotherStep hasRequest ]) ifFalse: [ ^ nil ].
	requestA := self comparableRequestOf: aStep in: left.
	requestB := self comparableRequestOf: anotherStep in: right.
	position := self firstDifferingIndexOf: requestA and: requestB.
	position ifNil: [ ^ nil ].
	^ self requestDifferenceAt: aStep index position: position left: requestA right: requestB
]

{ #category : 'private' }
TdAlignment >> requestReasonAt: aStepIndex index: anIndex left: aPair right: anotherPair diff: aDiff [

	| prefix |
	prefix := 'step ' , aStepIndex printString , ' request[' , anIndex printString , ']'.
	aPair ifNil: [ ^ prefix , ': only the second run has this ' , anotherPair key role asString , ' message' ].
	anotherPair ifNil: [ ^ prefix , ': only the first run has this ' , aPair key role asString , ' message' ].
	(aPair key isSystem and: [ anotherPair key isSystem ]) ifTrue: [
		^ prefix , ' (system): ' , (self harnessDescriptionFrom: aPair key to: anotherPair key) ].
	^ prefix , ' (' , aPair key role asString , ') ' , aDiff description
]

{ #category : 'private' }
TdAlignment >> reset [

	computed := false.
	difference := nil.
	idMaps := nil
]

{ #category : 'private' }
TdAlignment >> responseDifferenceBetween: aStep and: anotherStep [

	| diff |
	diff := TdJsonDiff
		        between: (self comparableResponseOf: aStep in: left)
		        and: (self comparableResponseOf: anotherStep in: right).
	diff hasDifference ifFalse: [ ^ nil ].
	^ (TdStepDifference
		   step: aStep index
		   part: #response
		   reason: 'step ' , aStep index printString , ' response ' , diff description)
		  diff: diff;
		  yourself
]

{ #category : 'accessing' }
TdAlignment >> right [

	^ right
]

{ #category : 'private' }
TdAlignment >> select: someKeys from: aBlock [

	| result |
	result := OrderedDictionary new.
	someKeys do: [ :key | (aBlock includesKey: key) ifTrue: [ result at: key put: (aBlock at: key) ] ].
	^ result
]

{ #category : 'initialization' }
TdAlignment >> setLeft: aRun right: anotherRun [

	left := aRun.
	right := anotherRun.
	lenient := #(  ).
	ignoreIds := true.
	self reset
]

{ #category : 'queries' }
TdAlignment >> sharedSteps [
	"How many steps the runs have in common before the first difference."

	^ self firstDifference
		  ifNil: [ self stepCount ]
		  ifNotNil: [ :found | found step - 1 ]
]

{ #category : 'queries' }
TdAlignment >> stepCount [

	^ left stepCount max: right stepCount
]
