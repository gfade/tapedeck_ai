"
I am where two runs first differ, as found by TdAlignment: the step, which part differs (#request, #response, or #missing when only one run has the step), the index of the first differing request message, the value-level difference (a TdJsonDiff) and a readable reason.
"
Class {
	#name : 'TdStepDifference',
	#superclass : 'Object',
	#instVars : [
		'step',
		'part',
		'messageIndex',
		'diff',
		'reason'
	],
	#category : 'TapeDeck-Analysis',
	#package : 'TapeDeck-Analysis'
}

{ #category : 'instance creation' }
TdStepDifference class >> step: anInteger part: aSymbol reason: aString [

	^ self new setStep: anInteger part: aSymbol reason: aString
]

{ #category : 'accessing' }
TdStepDifference >> diff [
	"A TdJsonDiff, or nil for a missing step."

	^ diff
]

{ #category : 'accessing' }
TdStepDifference >> diff: aJsonDiff [

	diff := aJsonDiff
]

{ #category : 'testing' }
TdStepDifference >> isInRequest [

	^ part = #request
]

{ #category : 'testing' }
TdStepDifference >> isInResponse [

	^ part = #response
]

{ #category : 'accessing' }
TdStepDifference >> messageIndex [
	"For a request difference: the 0-based index of the first differing message (after lenient filtering)."

	^ messageIndex
]

{ #category : 'accessing' }
TdStepDifference >> messageIndex: anInteger [

	messageIndex := anInteger
]

{ #category : 'accessing' }
TdStepDifference >> part [
	"#request, #response or #missing."

	^ part
]

{ #category : 'printing' }
TdStepDifference >> printOn: aStream [

	aStream nextPutAll: reason
]

{ #category : 'accessing' }
TdStepDifference >> reason [

	^ reason
]

{ #category : 'initialization' }
TdStepDifference >> setStep: anInteger part: aSymbol reason: aString [

	step := anInteger.
	part := aSymbol.
	reason := aString
]

{ #category : 'accessing' }
TdStepDifference >> step [

	^ step
]
