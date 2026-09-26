Extension { #name : 'TdRun' }

{ #category : '*TapeDeck-Analysis' }
TdRun >> alignmentWith: anotherRun [
	"Line me up with anotherRun step by step (see TdAlignment)."

	^ TdAlignment of: self with: anotherRun
]

{ #category : '*TapeDeck-Analysis' }
TdRun >> blockedCallsUnder: aPolicyOrVariant [
	"What-if: the recorded calls a policy (or a variant's policy) would have blocked."

	^ aPolicyOrVariant blockedCallsIn: self
]

{ #category : '*TapeDeck-Analysis' }
TdRun >> stats [

	^ TdStats on: self
]
