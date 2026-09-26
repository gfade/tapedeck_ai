"
I compute cheap statistics over recorded steps: tokens and cost by step, a tool-call histogram, a histogram of the programs bash ran, and the determinism ratio (the share of steps played back from a tape rather than answered live).

	(TdStats on: aRun) toolHistogram.	""{'bash'->2. 'edit'->2. 'read'->1}""
	(TdStats on: aStore) determinismRatio.
	(TdStats on: { runA. runB }) tokensByStep.
"
Class {
	#name : 'TdStats',
	#superclass : 'Object',
	#instVars : [
		'steps'
	],
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'instance creation' }
TdStats class >> on: aSource [
	"aSource: a run, a store, or a collection of runs."

	^ self new setSteps: (aSource isCollection
			   ifTrue: [ aSource flatCollect: [ :each | each steps ] ]
			   ifFalse: [ aSource steps ])
]

{ #category : 'histograms' }
TdStats >> commandHistogram [
	"The first word of each bash command -> count, most frequent first."

	^ self histogramOf: ((self toolCalls select: [ :each | each isBash and: [ each command isString ] ])
			   collect: [ :each | (each command substrings ifEmpty: [ #( '' ) ]) first ])
]

{ #category : 'per step' }
TdStats >> costByStep [
	"step index -> dollars, summed over runs."

	^ self sumByStep: [ :step | step cost ]
]

{ #category : 'ratios' }
TdStats >> determinismRatio [
	"The share of steps replayed from a tape (0 when there are no steps)."

	steps isEmpty ifTrue: [ ^ 0 ].
	^ (self replayedStepCount / steps size * 10000) rounded / 10000.0
]

{ #category : 'counting' }
TdStats >> errorCount [
	"Tool calls whose result was an error."

	^ self toolCalls count: [ :each | each isError == true ]
]

{ #category : 'private' }
TdStats >> histogramOf: aCollection [

	| counts |
	counts := Dictionary new.
	aCollection do: [ :each | counts at: each put: (counts at: each ifAbsent: [ 0 ]) + 1 ].
	^ counts associations asArray sorted: [ :a :b |
		  a value > b value or: [ a value = b value and: [ a key asString <= b key asString ] ] ]
]

{ #category : 'counting' }
TdStats >> liveStepCount [

	^ steps count: [ :each | each isLive ]
]

{ #category : 'printing' }
TdStats >> printOn: aStream [

	aStream
		nextPutAll: 'TdStats(';
		print: steps size;
		nextPutAll: ' steps, ';
		print: self replayedStepCount;
		nextPutAll: ' replayed, ';
		print: self toolCalls size;
		nextPutAll: ' tool calls)'
]

{ #category : 'counting' }
TdStats >> replayedStepCount [

	^ steps count: [ :each | each isReplayed ]
]

{ #category : 'initialization' }
TdStats >> setSteps: aCollectionOfSteps [

	steps := aCollectionOfSteps asArray
]

{ #category : 'counting' }
TdStats >> stepCount [

	^ steps size
]

{ #category : 'accessing' }
TdStats >> steps [

	^ steps
]

{ #category : 'private' }
TdStats >> sumByStep: aBlock [

	| sums |
	sums := Dictionary new.
	steps do: [ :each | sums at: each index put: (sums at: each index ifAbsent: [ 0 ]) + (aBlock value: each) ].
	^ sums associations asArray sorted: [ :a :b | a key <= b key ]
]

{ #category : 'per step' }
TdStats >> tokensByStep [
	"step index -> tokens as recorded, summed over runs."

	^ self sumByStep: [ :step | step tokens ]
]

{ #category : 'accessing' }
TdStats >> toolCalls [

	^ steps flatCollect: [ :each | each tools ]
]

{ #category : 'histograms' }
TdStats >> toolHistogram [
	"Tool name -> number of calls, most frequent first."

	^ self histogramOf: (self toolCalls collect: [ :each | each name ])
]
